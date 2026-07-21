using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32;
using System.Drawing;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        if (TrayAgentApplication.ShouldRunInTray(args)) return TrayAgentApplication.Run(args);
        return AgentProgram.RunAsync(args).GetAwaiter().GetResult();
    }
}

internal static class AgentProgram
{
    internal const string AgentVersion = "0.6.3";

    public static async Task<int> RunAsync(string[] args, CancellationToken cancellation = default)
    {
        try
        {
            Console.Title = $"OpsPilot Endpoint Agent {AgentVersion}";
            var options = CliOptions.Parse(args);
            AgentLog.Configure(DataDirectory(options));
            return options.Command switch
            {
                "enroll" => await EnrollCommandAsync(options, cancellation: cancellation),
                "once" => await OnceCommandAsync(options, cancellation),
                "run" => await RunCommandAsync(options, cancellation),
                "help" or "--help" or "-h" => PrintHelp(),
                "interactive" => await AutomaticAsync(options, cancellation),
                _ => throw new InvalidOperationException($"Unknown command '{options.Command}'. Run with --help for usage."),
            };
        }
        catch (OperationCanceledException)
        {
            AgentLog.Info("Agent stopped.");
            return 0;
        }
        catch (Exception error)
        {
            AgentLog.Error($"Error: {error.Message}");
            return 1;
        }
    }

    private static int PrintHelp()
    {
        Console.WriteLine($"""
            OpsPilot Endpoint Agent {AgentVersion}

            A personalized download self-enrolls and starts monitoring when launched.

            Commands:
              enroll --server <url> --token <one-time-token> [--data-dir <path>]
              once [--data-dir <path>]
              run [--data-dir <path>]

            The persistent agent runs in the Windows notification area, provisions the
            approved RustDesk client, and reports secure Windows RDP readiness. It does
            not expose a shell or arbitrary command runner.
            """);
        return 0;
    }

    private static async Task<int> AutomaticAsync(CliOptions options, CancellationToken cancellation)
    {
        PrintBanner();
        var dataDirectory = DataDirectory(options);
        if (EmbeddedEnrollmentPackage.TryLoad(out var package))
        {
            AgentLog.Info($"Personalized enrollment package detected for {new Uri(package.Server).Host}.");
            var result = await EnrollCommandAsync(options, package, cancellation);
            if (result != 0 || Environment.GetEnvironmentVariable("OPSPILOT_EXIT_AFTER_ENROLL") == "1") return result;
            return await RunAgentAsync(AgentConfigStore.Load(dataDirectory), once: false, cancellation);
        }

        if (AgentConfigStore.TryLoad(dataDirectory, out var existing)) return await RunAgentAsync(existing, once: false, cancellation);
        throw new InvalidOperationException("This executable has no embedded enrollment package. Download a personalized agent from the OpsPilot enrollment screen.");
    }

    private static async Task<int> EnrollCommandAsync(CliOptions options, EmbeddedEnrollment? embedded = null, CancellationToken cancellation = default)
    {
        embedded ??= EmbeddedEnrollmentPackage.TryLoad(out var packaged) ? packaged : null;
        var server = NormalizeServer(options.Get("server") ?? Environment.GetEnvironmentVariable("OPSPILOT_SERVER") ?? embedded?.Server ?? throw new InvalidOperationException("No OpsPilot server was provided or embedded."));
        var token = options.Get("token") ?? Environment.GetEnvironmentVariable("OPSPILOT_ENROLLMENT_TOKEN") ?? embedded?.Token;
        if (string.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("No enrollment token was provided or embedded.");

        if (new Uri(server).Scheme == Uri.UriSchemeHttp && !new Uri(server).IsLoopback)
        {
            AgentLog.Warning("Warning: this server uses unencrypted HTTP. Use HTTPS before enrolling across a network.");
        }

        AgentLog.Info("Collecting Windows host inventory...");
        var enrollment = await HostInventory.CreateEnrollmentAsync(AgentVersion);
        using var client = new AgentClient(server, AgentVersion);
        var response = await client.EnrollAsync(token, enrollment, cancellation);
        var config = AgentConfig.Create(server, response.DeviceId, response.AgentSecret, response.IntervalSeconds);
        var configPath = AgentConfigStore.Save(config, DataDirectory(options));
        await client.CheckInAsync(config.AgentSecret, await HostInventory.CreateCheckInAsync(AgentVersion), cancellation);
        await RemoteSupportInstaller.EnsureAsync(client, config, enrollment.Hostname, cancellation);

        AgentLog.Success($"Enrolled {enrollment.Hostname} as {response.DeviceId}.");
        AgentLog.Info($"Initial authenticated check-in accepted. Protected state saved to {configPath}");
        return 0;
    }

    private static async Task<int> OnceCommandAsync(CliOptions options, CancellationToken cancellation)
    {
        PrintBanner();
        return await RunAgentAsync(AgentConfigStore.Load(DataDirectory(options)), once: true, cancellation);
    }

    private static async Task<int> RunCommandAsync(CliOptions options, CancellationToken cancellation)
    {
        PrintBanner();
        return await RunAgentAsync(AgentConfigStore.Load(DataDirectory(options)), once: false, cancellation);
    }

    private static async Task<int> RunAgentAsync(AgentConfig config, bool once, CancellationToken externalCancellation)
    {
        using var client = new AgentClient(config.Server, AgentVersion);
        var nextRemoteSupportCheck = DateTimeOffset.MinValue;
        if (!once)
        {
            AgentLog.Info("Background monitoring started in the Windows notification area.");
            AgentLog.Info("RustDesk is the primary remote provider; Windows RDP is the fallback.");
        }

        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(externalCancellation);
        Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; cancellation.Cancel(); };
        do
        {
            try
            {
                var payload = await HostInventory.CreateCheckInAsync(AgentVersion);
                await client.CheckInAsync(config.AgentSecret, payload, cancellation.Token);
                AgentLog.Success($"[{DateTimeOffset.Now:O}] Check-in accepted: CPU {payload.Cpu:0.0}% · memory {payload.Memory:0.0}% · disk {payload.DiskUsedPercent:0.0}%");
                var processedTasks = await client.ProcessTasksAsync(config.AgentSecret, cancellation.Token);
                if (processedTasks) nextRemoteSupportCheck = DateTimeOffset.MinValue;
                if (DateTimeOffset.UtcNow >= nextRemoteSupportCheck)
                {
                    await RemoteSupportInstaller.EnsureAsync(client, config, Environment.MachineName, cancellation.Token);
                    nextRemoteSupportCheck = DateTimeOffset.UtcNow.AddMinutes(15);
                }
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { break; }
            catch (Exception error)
            {
                AgentLog.Error($"[{DateTimeOffset.Now:O}] {error.Message}");
                if (once) throw;
            }
            if (!once) await Task.Delay(TimeSpan.FromSeconds(Math.Max(15, config.IntervalSeconds)), cancellation.Token);
        } while (!once && !cancellation.IsCancellationRequested);
        return 0;
    }

    private static string NormalizeServer(string value)
    {
        if (!Uri.TryCreate(value.Trim().TrimEnd('/'), UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new InvalidOperationException("The server must be an absolute HTTP or HTTPS URL.");
        return uri.GetLeftPart(UriPartial.Authority);
    }

    internal static string? DataDirectory(CliOptions options) => options.Get("data-dir") ?? Environment.GetEnvironmentVariable("OPSPILOT_DATA_DIR");

    private static void PrintBanner()
    {
        AgentLog.Info($"OpsPilot Endpoint Agent {AgentVersion}");
    }
}

internal static class TrayAgentApplication
{
    private const string SingleInstanceName = "Local\\OpsPilot.Endpoint.Agent";

    public static bool ShouldRunInTray(string[] args)
    {
        if (Environment.GetEnvironmentVariable("OPSPILOT_EXIT_AFTER_ENROLL") == "1") return false;
        var command = CliOptions.Parse(args).Command;
        return command is "interactive" or "run";
    }

    public static int Run(string[] args)
    {
        NativeConsole.Hide();
        ApplicationConfiguration.Initialize();
        using var singleInstance = new Mutex(initiallyOwned: true, SingleInstanceName, out var isFirstInstance);
        if (!isFirstInstance)
        {
            MessageBox.Show(
                "OpsPilot Endpoint Agent is already running in the Windows notification area.",
                "OpsPilot Endpoint Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return 0;
        }

        CloseLegacyConsoleInstances();
        using var context = new AgentTrayContext(args);
        Application.Run(context);
        singleInstance.ReleaseMutex();
        return context.ExitCode;
    }

    private static void CloseLegacyConsoleInstances()
    {
        var currentId = Environment.ProcessId;
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                try
                {
                    if (process.Id == currentId || !process.MainWindowTitle.StartsWith("OpsPilot Endpoint Agent", StringComparison.OrdinalIgnoreCase)) continue;
                    if (process.CloseMainWindow() && process.WaitForExit(3000)) continue;
                    process.Kill(entireProcessTree: true);
                    _ = process.WaitForExit(3000);
                }
                catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception)
                {
                    AgentLog.Warning($"Could not close the previous foreground agent: {error.Message}");
                }
            }
        }
    }
}

internal sealed class AgentTrayContext : ApplicationContext
{
    private readonly string[] _args;
    private readonly string? _dataDirectory;
    private readonly CancellationTokenSource _cancellation = new();
    private readonly NotifyIcon _notifyIcon;
    private readonly ToolStripMenuItem _statusItem;
    private readonly System.Windows.Forms.Timer _statusTimer;
    private Task<int>? _agentTask;
    private string? _lastStatus;
    private bool _exiting;

    public AgentTrayContext(string[] args)
    {
        _args = args;
        _dataDirectory = AgentProgram.DataDirectory(CliOptions.Parse(args));
        AgentLog.Configure(_dataDirectory);

        _statusItem = new ToolStripMenuItem("Starting agent…") { Enabled = false };
        var openConsoleItem = new ToolStripMenuItem("Open OpsPilot Console", null, (_, _) => OpenOpsPilotConsole()) { Font = new Font(SystemFonts.MenuFont ?? SystemFonts.DefaultFont, FontStyle.Bold) };
        var openLogItem = new ToolStripMenuItem("Open Agent Log", null, (_, _) => OpenAgentLog());
        var exitItem = new ToolStripMenuItem("Exit Agent", null, (_, _) => ExitAgent());
        var menu = new ContextMenuStrip();
        menu.Items.AddRange([_statusItem, new ToolStripSeparator(), openConsoleItem, openLogItem, new ToolStripSeparator(), exitItem]);

        _notifyIcon = new NotifyIcon
        {
            Icon = SystemIcons.Shield,
            Text = $"OpsPilot Endpoint Agent {AgentProgram.AgentVersion}",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _notifyIcon.DoubleClick += (_, _) => OpenOpsPilotConsole();

        _statusTimer = new System.Windows.Forms.Timer { Interval = 750, Enabled = true };
        _statusTimer.Tick += (_, _) => RefreshStatus();
        StartAgent();
    }

    public int ExitCode { get; private set; }

    private void StartAgent()
    {
        _agentTask = Task.Run(() => AgentProgram.RunAsync(_args, _cancellation.Token));
        _ = _agentTask.ContinueWith(task =>
        {
            if (task.IsFaulted)
            {
                ExitCode = 1;
                AgentLog.Error(task.Exception?.GetBaseException().Message ?? "The agent stopped unexpectedly.");
            }
            else
            {
                ExitCode = task.Result;
                if (!_cancellation.IsCancellationRequested) AgentLog.Warning($"Agent monitoring stopped with exit code {ExitCode}.");
            }
        }, TaskScheduler.Default);
    }

    private void RefreshStatus()
    {
        var entry = AgentLog.LastEntry;
        if (entry is null || string.Equals(entry.Message, _lastStatus, StringComparison.Ordinal)) return;
        _lastStatus = entry.Message;

        if (entry.Message.Contains("Check-in accepted", StringComparison.OrdinalIgnoreCase))
        {
            _statusItem.Text = $"Healthy — last check-in {entry.Timestamp:HH:mm:ss}";
            _notifyIcon.Text = $"OpsPilot Agent {AgentProgram.AgentVersion} — healthy";
        }
        else if (entry.Level == AgentLogLevel.Error)
        {
            _statusItem.Text = $"Error — {Compact(entry.Message, 72)}";
            _notifyIcon.Text = $"OpsPilot Agent {AgentProgram.AgentVersion} — attention required";
        }
        else
        {
            _statusItem.Text = Compact(entry.Message, 88);
        }
    }

    private void OpenOpsPilotConsole()
    {
        try
        {
            if (!AgentConfigStore.TryLoad(_dataDirectory, out var config))
                throw new InvalidOperationException("The agent has not finished enrollment yet.");
            Process.Start(new ProcessStartInfo(config.Server) { UseShellExecute = true });
        }
        catch (Exception error)
        {
            ShowNotification("OpsPilot console unavailable", error.Message, ToolTipIcon.Warning);
        }
    }

    private void OpenAgentLog()
    {
        try
        {
            var logPath = AgentLog.LogPath;
            if (string.IsNullOrWhiteSpace(logPath) || !File.Exists(logPath)) throw new FileNotFoundException("The agent log has not been created yet.");
            Process.Start(new ProcessStartInfo(logPath) { UseShellExecute = true });
        }
        catch (Exception error)
        {
            ShowNotification("Agent log unavailable", error.Message, ToolTipIcon.Warning);
        }
    }

    private void ShowNotification(string title, string message, ToolTipIcon icon)
    {
        _notifyIcon.BalloonTipTitle = title;
        _notifyIcon.BalloonTipText = Compact(message, 220);
        _notifyIcon.BalloonTipIcon = icon;
        _notifyIcon.ShowBalloonTip(5000);
    }

    private void ExitAgent()
    {
        if (_exiting) return;
        _exiting = true;
        AgentLog.Info("Exit requested from the Windows notification area.");
        _cancellation.Cancel();
        _notifyIcon.Visible = false;
        ExitThread();
    }

    protected override void ExitThreadCore()
    {
        _statusTimer.Stop();
        _statusTimer.Dispose();
        _notifyIcon.Visible = false;
        _notifyIcon.ContextMenuStrip?.Dispose();
        _notifyIcon.Dispose();
        _cancellation.Cancel();
        _cancellation.Dispose();
        base.ExitThreadCore();
    }

    private static string Compact(string value, int maximumLength)
    {
        var singleLine = value.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return singleLine.Length <= maximumLength ? singleLine : $"{singleLine[..(maximumLength - 1)]}…";
    }
}

internal enum AgentLogLevel { Info, Success, Warning, Error }
internal sealed record AgentLogEntry(DateTimeOffset Timestamp, AgentLogLevel Level, string Message);

internal static class AgentLog
{
    private const long MaximumLogBytes = 2 * 1024 * 1024;
    private static readonly object Sync = new();
    private static string? _logPath;
    private static AgentLogEntry? _lastEntry;

    public static string? LogPath { get { lock (Sync) return _logPath; } }
    public static AgentLogEntry? LastEntry { get { lock (Sync) return _lastEntry; } }

    public static void Configure(string? explicitDirectory)
    {
        lock (Sync)
        {
            if (!string.IsNullOrWhiteSpace(_logPath)) return;
            foreach (var directory in LogDirectories(explicitDirectory))
            {
                try
                {
                    Directory.CreateDirectory(directory);
                    _logPath = Path.Combine(directory, "agent.log");
                    return;
                }
                catch (Exception error) when (error is UnauthorizedAccessException or IOException) { }
            }
        }
    }

    public static void Info(string message) => Write(AgentLogLevel.Info, message, isError: false);
    public static void Success(string message) => Write(AgentLogLevel.Success, message, isError: false);
    public static void Warning(string message) => Write(AgentLogLevel.Warning, message, isError: true);
    public static void Error(string message) => Write(AgentLogLevel.Error, message, isError: true);

    private static void Write(AgentLogLevel level, string message, bool isError)
    {
        var entry = new AgentLogEntry(DateTimeOffset.Now, level, message);
        if (isError) Console.Error.WriteLine(message); else Console.WriteLine(message);
        lock (Sync)
        {
            _lastEntry = entry;
            if (string.IsNullOrWhiteSpace(_logPath)) Configure(null);
            if (string.IsNullOrWhiteSpace(_logPath)) return;
            try
            {
                if (File.Exists(_logPath) && new FileInfo(_logPath).Length >= MaximumLogBytes)
                    File.Move(_logPath, $"{_logPath}.1", overwrite: true);
                File.AppendAllText(_logPath, $"[{entry.Timestamp:O}] [{entry.Level}] {entry.Message}{Environment.NewLine}", new UTF8Encoding(false));
            }
            catch (Exception error) when (error is UnauthorizedAccessException or IOException) { }
        }
    }

    private static IEnumerable<string> LogDirectories(string? explicitDirectory)
    {
        if (!string.IsNullOrWhiteSpace(explicitDirectory)) yield return Path.GetFullPath(explicitDirectory);
        yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "OpsPilot Agent", "logs");
        yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpsPilot Agent", "logs");
    }
}

internal static class NativeConsole
{
    private const int HideWindow = 0;

    public static void Hide()
    {
        var window = GetConsoleWindow();
        if (window != IntPtr.Zero) _ = ShowWindow(window, HideWindow);
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr window, int command);
}

internal sealed class AgentClient(string server, string version) : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
    private static readonly HashSet<string> AllowedTasks = ["refresh-agent", "inventory-refresh"];
    private readonly HttpClient _http = CreateClient(server, version);

    public Task<EnrollmentResponse> EnrollAsync(string token, EnrollmentPayload payload, CancellationToken cancellation = default) =>
        PostAsync<EnrollmentResponse>("/api/agent/enroll", new { token, payload.Hostname, payload.DisplayName, payload.Role, payload.OperatingSystem, payload.OsVersion, payload.Manufacturer, payload.Model, payload.SerialNumber, payload.Cpu, payload.MemoryGb, payload.DiskCapacityGb, payload.DiskUsedPercent, payload.IpAddress, payload.LastLoggedInUser, payload.AgentVersion, payload.UptimeMinutes }, null, cancellation);

    public async Task CheckInAsync(string secret, CheckInPayload payload, CancellationToken cancellation = default) =>
        _ = await PostAsync<JsonElement>("/api/agent/check-in", payload, secret, cancellation);

    public async Task<bool> ProcessTasksAsync(string secret, CancellationToken cancellation = default)
    {
        using var request = Authorized(HttpMethod.Get, "/api/agent/tasks", secret);
        using var response = await _http.SendAsync(request, cancellation);
        var body = await ReadBodyAsync(response, cancellation);
        EnsureSuccess(response, body);
        var tasks = JsonSerializer.Deserialize<TaskEnvelope>(body, JsonOptions)?.Tasks ?? [];
        foreach (var task in tasks)
        {
            var status = "succeeded";
            var output = "Authenticated Windows agent inventory refresh completed.";
            string? failureReason = null;
            try
            {
                if (!AllowedTasks.Contains(task.Action)) throw new InvalidOperationException("Task is not in the endpoint allowlist.");
                await CheckInAsync(secret, await HostInventory.CreateCheckInAsync(version), cancellation);
                AgentLog.Success($"Completed allowlisted task {task.Action} ({task.Id}).");
            }
            catch (Exception error)
            {
                status = "failed";
                output = "";
                failureReason = error.Message;
            }
            _ = await PostAsync<JsonElement>($"/api/agent/tasks/{Uri.EscapeDataString(task.Id)}/complete", new { status, output, failureReason }, secret, cancellation);
        }
        return tasks.Count > 0;
    }

    public async Task<RemoteSupportBootstrap> GetRemoteSupportBootstrapAsync(string secret, CancellationToken cancellation = default)
    {
        using var request = Authorized(HttpMethod.Get, "/api/agent/remote-support/bootstrap", secret);
        using var response = await _http.SendAsync(request, cancellation);
        var body = await ReadBodyAsync(response, cancellation);
        EnsureSuccess(response, body);
        return JsonSerializer.Deserialize<RemoteSupportBootstrap>(body, JsonOptions) ?? throw new InvalidOperationException("The remote-support bootstrap response was empty.");
    }

    public async Task DownloadRemoteAssetAsync(string assetUrl, string destination, string secret, CancellationToken cancellation = default)
    {
        using var request = Authorized(HttpMethod.Get, assetUrl, secret);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation);
        var body = response.IsSuccessStatusCode ? null : await ReadBodyAsync(response, cancellation);
        EnsureSuccess(response, body ?? string.Empty);
        Directory.CreateDirectory(Path.GetDirectoryName(destination) ?? throw new InvalidOperationException("The remote-support cache path is invalid."));
        await using var source = await response.Content.ReadAsStreamAsync(cancellation);
        await using var target = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None);
        await source.CopyToAsync(target, cancellation);
    }

    public async Task ReportRemoteProvidersAsync(string secret, IReadOnlyCollection<RemoteProviderReport> providers, CancellationToken cancellation = default) =>
        _ = await PostAsync<JsonElement>("/api/agent/remote-support/bootstrap", new { providers }, secret, cancellation);

    private async Task<T> PostAsync<T>(string path, object payload, string? secret, CancellationToken cancellation)
    {
        using var request = Authorized(HttpMethod.Post, path, secret);
        request.Content = JsonContent.Create(payload, options: JsonOptions);
        using var response = await _http.SendAsync(request, cancellation);
        var body = await ReadBodyAsync(response, cancellation);
        EnsureSuccess(response, body);
        return JsonSerializer.Deserialize<T>(body, JsonOptions) ?? throw new InvalidOperationException("The OpsPilot response was empty.");
    }

    private static HttpClient CreateClient(string server, string version)
    {
        var client = new HttpClient { BaseAddress = new Uri(server), Timeout = TimeSpan.FromMinutes(5) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("OpsPilot-Agent", version));
        return client;
    }

    private static HttpRequestMessage Authorized(HttpMethod method, string path, string? secret)
    {
        var request = new HttpRequestMessage(method, path);
        if (!string.IsNullOrWhiteSpace(secret)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", secret);
        return request;
    }

    private static async Task<string> ReadBodyAsync(HttpResponseMessage response, CancellationToken cancellation) => await response.Content.ReadAsStringAsync(cancellation);

    private static void EnsureSuccess(HttpResponseMessage response, string body)
    {
        if (response.IsSuccessStatusCode) return;
        try
        {
            var error = JsonSerializer.Deserialize<ApiError>(body, JsonOptions)?.Error;
            throw new InvalidOperationException(error ?? $"OpsPilot returned HTTP {(int)response.StatusCode}.");
        }
        catch (JsonException) { throw new InvalidOperationException($"OpsPilot returned HTTP {(int)response.StatusCode}: {body}"); }
    }

    public void Dispose() => _http.Dispose();
}

internal static class RemoteSupportInstaller
{
    private static readonly string CacheDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "OpsPilot Agent", "remote-cache");

    public static async Task EnsureAsync(AgentClient client, AgentConfig config, string hostname, CancellationToken cancellation = default)
    {
        try
        {
            await RemoveDeprecatedMeshAgentAsync(cancellation);
            var bootstrap = await client.GetRemoteSupportBootstrapAsync(config.AgentSecret, cancellation);
            var reports = new List<RemoteProviderReport>();

            if (bootstrap.Providers.Rustdesk.Enabled && bootstrap.Providers.Rustdesk.Current?.Status != "ready")
            {
                reports.Add(await InstallRustDeskAsync(client, config, bootstrap.Providers.Rustdesk, cancellation));
            }
            else if (!bootstrap.Providers.Rustdesk.Enabled && bootstrap.Providers.Rustdesk.Current?.Status != "failed")
            {
                reports.Add(new RemoteProviderReport(
                    "rustdesk",
                    bootstrap.Providers.Rustdesk.Current?.ExternalId ?? "unavailable",
                    "failed",
                    null,
                    bootstrap.Providers.Rustdesk.DisabledReason ?? "RustDesk provisioning is disabled by the control plane.",
                    "1.4.9"));
            }

            if (bootstrap.Providers.Rdp.Enabled) reports.Add(InspectRdp(hostname));

            if (reports.Count > 0)
            {
                await client.ReportRemoteProvidersAsync(config.AgentSecret, reports, cancellation);
                foreach (var report in reports) AgentLog.Info($"{ProviderLabel(report.Provider)} remote support: {report.Status} ({report.ExternalId}).");
            }
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch (Exception error)
        {
            AgentLog.Warning($"Remote-support provisioning will retry: {error.Message}");
        }
    }

    private static async Task RemoveDeprecatedMeshAgentAsync(CancellationToken cancellation)
    {
        var executable = FindExistingOrNull(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Mesh Agent", "MeshAgent.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Mesh Agent", "MeshAgent.exe"));
        if (executable is null) return;
        try
        {
            var uninstall = await RunProcessAsync(executable, ["-fulluninstall"], TimeSpan.FromSeconds(45), cancellation);
            if (uninstall.ExitCode != 0) throw new InvalidOperationException($"MeshAgent removal returned {uninstall.ExitCode}: {uninstall.Error}");
            AgentLog.Info("Removed the deprecated MeshCentral endpoint agent.");
        }
        catch (TimeoutException) when (!File.Exists(executable))
        {
            AgentLog.Info("Removed the deprecated MeshCentral endpoint agent; detached its lingering uninstaller.");
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            AgentLog.Warning($"MeshCentral endpoint cleanup will retry: {error.Message}");
        }
    }

    private static async Task<RemoteProviderReport> InstallRustDeskAsync(AgentClient client, AgentConfig config, RemoteProviderBootstrap provider, CancellationToken cancellation)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(provider.IdServer) || string.IsNullOrWhiteSpace(provider.RelayServer) || string.IsNullOrWhiteSpace(provider.Key))
                throw new InvalidOperationException("RustDesk server configuration is incomplete.");

            var executable = FindExistingOrNull(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "RustDesk", "rustdesk.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "RustDesk", "RustDesk.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "RustDesk", "rustdesk.exe"));
            if (executable is null)
            {
                var package = Path.Combine(CacheDirectory, "rustdesk-windows-x64.exe");
                await client.DownloadRemoteAssetAsync(provider.AssetUrl, package, config.AgentSecret, cancellation);
                try
                {
                    var install = await RunProcessAsync(package, ["--silent-install"], TimeSpan.FromSeconds(45), cancellation);
                    if (install.ExitCode != 0) throw new InvalidOperationException($"RustDesk installation returned {install.ExitCode}: {install.Error}");
                }
                catch (TimeoutException) when (FindExistingOrNull(
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "RustDesk", "rustdesk.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "RustDesk", "RustDesk.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "RustDesk", "rustdesk.exe")) is not null)
                {
                    AgentLog.Info("RustDesk service installation completed; detached the lingering installer process.");
                }
                executable = FindExisting(
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "RustDesk", "rustdesk.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "RustDesk", "RustDesk.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "RustDesk", "rustdesk.exe"));
            }

            await RunBestEffortAsync("sc.exe", ["stop", "RustDesk"], cancellation);
            WriteRustDeskConfiguration(provider);
            await RunBestEffortAsync("sc.exe", ["start", "RustDesk"], cancellation);
            await Task.Delay(TimeSpan.FromSeconds(3), cancellation);

            var password = CreatePassword();
            var passwordResult = await RunProcessAsync(executable, ["--password", password], TimeSpan.FromSeconds(30), cancellation);
            if (passwordResult.ExitCode != 0) throw new InvalidOperationException($"RustDesk password setup returned {passwordResult.ExitCode}: {passwordResult.Error}");
            var identity = await RunProcessAsync(executable, ["--get-id"], TimeSpan.FromSeconds(30), cancellation);
            var externalId = identity.Output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).LastOrDefault()?.Trim() ?? "";
            if (identity.ExitCode != 0 || externalId.Length is < 3 or > 128 || externalId.Any(character => !char.IsLetterOrDigit(character) && character is not '_' and not '-'))
                throw new InvalidOperationException("RustDesk did not return a valid endpoint identifier.");
            return new RemoteProviderReport("rustdesk", externalId, "ready", password, null, "1.4.9");
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            return new RemoteProviderReport("rustdesk", "unavailable", "failed", null, error.Message, "1.4.9");
        }
    }

    private static void WriteRustDeskConfiguration(RemoteProviderBootstrap provider)
    {
        var options = $"""
            rendezvous_server = ''
            nat_type = 1
            serial = 0

            [options]
            custom-rendezvous-server = '{Toml(provider.IdServer!)}'
            relay-server = '{Toml(provider.RelayServer!)}'
            key = '{Toml(provider.Key!)}'
            verification-method = 'use-permanent-password'
            allow-auto-update = 'N'
            enable-lan-discovery = 'N'
            allow-remote-config-modification = 'N'
            """;
        var profiles = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "RustDesk", "config"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "config", "systemprofile", "AppData", "Roaming", "RustDesk", "config"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "ServiceProfiles", "LocalService", "AppData", "Roaming", "RustDesk", "config"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RustDesk", "config"),
        };
        foreach (var directory in profiles.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, "RustDesk2.toml"), options, new UTF8Encoding(false));
        }
    }

    private static string Toml(string value) => value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("'", "\\'", StringComparison.Ordinal);
    private static string CreatePassword() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(18)).Replace('+', 'A').Replace('/', 'B').TrimEnd('=');
    private static string ProviderLabel(string provider) => provider == "rustdesk" ? "RustDesk" : "Windows RDP";

    private static RemoteProviderReport InspectRdp(string hostname)
    {
        const string terminalServerPath = @"SYSTEM\CurrentControlSet\Control\Terminal Server";
        const string rdpTcpPath = @"SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp";
        const int defaultPort = 3389;
        try
        {
            using var terminalServer = Registry.LocalMachine.OpenSubKey(terminalServerPath);
            using var rdpTcp = Registry.LocalMachine.OpenSubKey(rdpTcpPath);
            var denied = Convert.ToInt32(terminalServer?.GetValue("fDenyTSConnections", 1));
            var nla = Convert.ToInt32(rdpTcp?.GetValue("UserAuthentication", 0));
            var port = Convert.ToInt32(rdpTcp?.GetValue("PortNumber", defaultPort));
            var externalId = $"{HostInventory.PrimaryNetwork().IpAddress}:{port}";
            if (denied != 0) return new RemoteProviderReport("rdp", externalId, "failed", null, "Remote Desktop is disabled on this endpoint.", "Windows RDP");
            if (nla != 1) return new RemoteProviderReport("rdp", externalId, "failed", null, "Remote Desktop is enabled but Network Level Authentication is not required.", "Windows RDP");
            var listening = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(endpoint => endpoint.Port == port);
            if (!listening) return new RemoteProviderReport("rdp", externalId, "failed", null, $"Remote Desktop is enabled but TCP {port} is not listening.", "Windows RDP");
            return new RemoteProviderReport("rdp", externalId, "ready", null, null, "NLA");
        }
        catch (Exception error)
        {
            return new RemoteProviderReport("rdp", $"{hostname}:{defaultPort}", "failed", null, error.Message, "Windows RDP");
        }
    }

    private static string? FindExistingOrNull(params string[] paths) => paths.FirstOrDefault(File.Exists);
    private static string FindExisting(params string[] paths) => FindExistingOrNull(paths) ?? throw new FileNotFoundException("The installed remote-support executable was not found.");

    private static async Task RunBestEffortAsync(string executable, IReadOnlyList<string> arguments, CancellationToken cancellation)
    {
        try { _ = await RunProcessAsync(executable, arguments, TimeSpan.FromSeconds(30), cancellation); }
        catch (Exception error) when (error is not OperationCanceledException) { AgentLog.Warning(error.Message); }
    }

    private static async Task<ProcessResult> RunProcessAsync(string executable, IReadOnlyList<string> arguments, TimeSpan timeout, CancellationToken cancellation)
    {
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException($"Could not start {Path.GetFileName(executable)}.");
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeoutSource.CancelAfter(timeout);
        var outputTask = process.StandardOutput.ReadToEndAsync();
        var errorTask = process.StandardError.ReadToEndAsync();
        try { await process.WaitForExitAsync(timeoutSource.Token); }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw new TimeoutException($"{Path.GetFileName(executable)} did not finish within {timeout.TotalSeconds:0} seconds.");
        }
        return new ProcessResult(process.ExitCode, (await outputTask).Trim(), (await errorTask).Trim());
    }

    private sealed record ProcessResult(int ExitCode, string Output, string Error);
}

internal static class AgentConfigStore
{
    private const string ConfigName = "windows-agent.json";
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("OpsPilot.Agent.Config.v1");

    public static string Save(AgentConfig config, string? explicitDirectory)
    {
        Exception? lastError = null;
        foreach (var directory in CandidateDirectories(explicitDirectory, forWrite: true))
        {
            try
            {
                Directory.CreateDirectory(directory);
                var path = Path.Combine(directory, ConfigName);
                var protectedConfig = new StoredAgentConfig(config.Server, config.DeviceId, Protect(config.AgentSecret), config.IntervalSeconds, DateTimeOffset.UtcNow);
                File.WriteAllText(path, JsonSerializer.Serialize(protectedConfig, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }), new UTF8Encoding(false));
                return path;
            }
            catch (Exception error) when (error is UnauthorizedAccessException or IOException)
            {
                lastError = error;
                if (!string.IsNullOrWhiteSpace(explicitDirectory)) break;
            }
        }
        throw new InvalidOperationException($"Agent state could not be saved. {lastError?.Message}");
    }

    public static AgentConfig Load(string? explicitDirectory)
    {
        if (TryLoad(explicitDirectory, out var config)) return config;
        throw new InvalidOperationException("No Windows agent enrollment was found. Double-click the executable to enroll first, or pass --data-dir.");
    }

    public static bool TryLoad(string? explicitDirectory, out AgentConfig config)
    {
        foreach (var directory in CandidateDirectories(explicitDirectory, forWrite: false))
        {
            var path = Path.Combine(directory, ConfigName);
            if (!File.Exists(path)) continue;
            var stored = JsonSerializer.Deserialize<StoredAgentConfig>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true }) ?? throw new InvalidOperationException($"Agent state at {path} is invalid.");
            config = new AgentConfig(stored.Server, stored.DeviceId, Unprotect(stored.ProtectedAgentSecret), stored.IntervalSeconds);
            return true;
        }
        config = default!;
        return false;
    }

    private static IEnumerable<string> CandidateDirectories(string? explicitDirectory, bool forWrite)
    {
        if (!string.IsNullOrWhiteSpace(explicitDirectory)) { yield return Path.GetFullPath(explicitDirectory); yield break; }
        yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "OpsPilot Agent");
        yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpsPilot Agent");
        if (!forWrite) yield return Path.Combine(AppContext.BaseDirectory, ".opspilot-agent");
    }

    private static string Protect(string secret) => Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(secret), Entropy, DataProtectionScope.CurrentUser));
    private static string Unprotect(string secret) => Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(secret), Entropy, DataProtectionScope.CurrentUser));
}

internal static class EmbeddedEnrollmentPackage
{
    private static readonly byte[] Marker = Encoding.ASCII.GetBytes("OPSPILOT_ENROLLMENT_V1");
    private const int MaximumPayloadBytes = 4096;

    public static bool TryLoad(out EmbeddedEnrollment package)
    {
        package = default!;
        var executable = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(executable) || !File.Exists(executable)) return false;

        using var stream = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        if (stream.Length < Marker.Length + sizeof(int)) return false;

        var markerStart = stream.Length - Marker.Length;
        stream.Position = markerStart;
        var marker = new byte[Marker.Length];
        stream.ReadExactly(marker);
        if (!marker.AsSpan().SequenceEqual(Marker)) return false;

        stream.Position = markerStart - sizeof(int);
        Span<byte> lengthBytes = stackalloc byte[sizeof(int)];
        stream.ReadExactly(lengthBytes);
        var payloadLength = BitConverter.ToInt32(lengthBytes);
        if (payloadLength <= 0 || payloadLength > MaximumPayloadBytes || markerStart - sizeof(int) - payloadLength < 0)
            throw new InvalidOperationException("The embedded enrollment package is invalid.");

        stream.Position = markerStart - sizeof(int) - payloadLength;
        var payload = new byte[payloadLength];
        stream.ReadExactly(payload);
        package = JsonSerializer.Deserialize<EmbeddedEnrollment>(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("The embedded enrollment package is empty.");
        if (!Uri.TryCreate(package.Server, UriKind.Absolute, out var server) || (server.Scheme != Uri.UriSchemeHttp && server.Scheme != Uri.UriSchemeHttps) || package.Token.Length is < 32 or > 180)
            throw new InvalidOperationException("The embedded enrollment package is invalid.");
        return true;
    }
}

internal static class HostInventory
{
    public static async Task<EnrollmentPayload> CreateEnrollmentAsync(string version)
    {
        var disk = SystemDisk();
        var network = PrimaryNetwork();
        return new EnrollmentPayload(
            Environment.MachineName,
            Environment.MachineName,
            "Windows Endpoint",
            "Windows",
            RuntimeInformation.OSDescription,
            "Reported by Windows",
            RuntimeInformation.OSArchitecture.ToString(),
            "Not reported",
            Environment.GetEnvironmentVariable("PROCESSOR_IDENTIFIER") ?? RuntimeInformation.ProcessArchitecture.ToString(),
            Math.Max(1, (int)Math.Round(NativeWindows.TotalPhysicalMemoryBytes() / Math.Pow(1024, 3))),
            disk.CapacityGb,
            disk.UsedPercent,
            network.IpAddress,
            $"{Environment.UserDomainName}\\{Environment.UserName}",
            version,
            Math.Max(0, Environment.TickCount64 / 60_000));
    }

    public static async Task<CheckInPayload> CreateCheckInAsync(string version)
    {
        var disk = SystemDisk();
        var network = PrimaryNetwork();
        var started = Environment.TickCount64;
        var cpu = await NativeWindows.CpuPercentAsync();
        return new CheckInPayload(
            cpu,
            NativeWindows.MemoryLoadPercent(),
            disk.UsedPercent,
            disk.CapacityGb,
            (int)Math.Clamp(Environment.TickCount64 - started, 0, 600_000),
            Math.Max(0, Environment.TickCount64 / 60_000),
            IsPendingReboot(),
            version,
            network.IpAddress,
            $"{Environment.UserDomainName}\\{Environment.UserName}",
            new HardwarePayload("Not reported", null, Math.Max(1, Environment.ProcessorCount), network.MacAddress),
            [new SoftwarePayload("OpsPilot Endpoint Agent", version, "OpsPilot"), new SoftwarePayload(".NET Runtime", Environment.Version.ToString(), "Microsoft")]);
    }

    private static (int CapacityGb, double UsedPercent) SystemDisk()
    {
        try
        {
            var root = Path.GetPathRoot(Environment.SystemDirectory) ?? "C:\\";
            var drive = new DriveInfo(root);
            var used = drive.TotalSize > 0 ? (1d - drive.AvailableFreeSpace / (double)drive.TotalSize) * 100d : 0d;
            return ((int)Math.Clamp(Math.Round(drive.TotalSize / Math.Pow(1024, 3)), 0, int.MaxValue), Math.Round(used, 1));
        }
        catch { return (0, 0); }
    }

    internal static (string IpAddress, string MacAddress) PrimaryNetwork()
    {
        var candidates = NetworkInterface.GetAllNetworkInterfaces()
            .Where(adapter => adapter.OperationalStatus == OperationalStatus.Up && adapter.NetworkInterfaceType is not NetworkInterfaceType.Loopback and not NetworkInterfaceType.Tunnel)
            .SelectMany(adapter =>
            {
                var properties = adapter.GetIPProperties();
                var hasGateway = properties.GatewayAddresses.Any(gateway => gateway.Address.AddressFamily == AddressFamily.InterNetwork && !gateway.Address.Equals(IPAddress.Any));
                return properties.UnicastAddresses
                    .Where(item => item.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(item.Address) && !IsLinkLocal(item.Address))
                    .Select(item => new
                    {
                        Adapter = adapter,
                        item.Address,
                        Score = (hasGateway ? 200 : 0)
                            + (adapter.NetworkInterfaceType is NetworkInterfaceType.Ethernet or NetworkInterfaceType.Wireless80211 ? 100 : 0)
                            + (IsPrivateLan(item.Address) ? 50 : 0)
                            + (IsPhysicalAdapter(adapter) ? 25 : 0),
                    });
            })
            .OrderByDescending(candidate => candidate.Score)
            .ThenBy(candidate => candidate.Adapter.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var selected = candidates.FirstOrDefault();
        if (selected is not null)
        {
            var mac = string.Join(":", selected.Adapter.GetPhysicalAddress().GetAddressBytes().Select(value => value.ToString("X2")));
            return (selected.Address.ToString(), string.IsNullOrWhiteSpace(mac) ? "Not reported" : mac);
        }
        return ("127.0.0.1", "Not reported");
    }

    private static bool IsLinkLocal(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return bytes.Length == 4 && bytes[0] == 169 && bytes[1] == 254;
    }

    private static bool IsPrivateLan(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return bytes.Length == 4 && (bytes[0] == 10 || (bytes[0] == 172 && bytes[1] is >= 16 and <= 31) || (bytes[0] == 192 && bytes[1] == 168));
    }

    private static bool IsPhysicalAdapter(NetworkInterface adapter)
    {
        var identity = $"{adapter.Name} {adapter.Description}";
        return !new[] { "virtual", "hyper-v", "vethernet", "vpn", "tailscale", "docker", "loopback" }.Any(value => identity.Contains(value, StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsPendingReboot()
    {
        try
        {
            using var componentServicing = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending");
            using var windowsUpdate = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired");
            using var sessionManager = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Session Manager");
            return componentServicing is not null || windowsUpdate is not null || sessionManager?.GetValue("PendingFileRenameOperations") is not null;
        }
        catch { return false; }
    }
}

internal static class NativeWindows
{
    public static async Task<double> CpuPercentAsync()
    {
        if (!GetSystemTimes(out var idle1, out var kernel1, out var user1)) return 0;
        await Task.Delay(500);
        if (!GetSystemTimes(out var idle2, out var kernel2, out var user2)) return 0;
        var idle = ToUInt64(idle2) - ToUInt64(idle1);
        var total = (ToUInt64(kernel2) - ToUInt64(kernel1)) + (ToUInt64(user2) - ToUInt64(user1));
        return total == 0 ? 0 : Math.Round(Math.Clamp((1d - idle / (double)total) * 100d, 0, 100), 1);
    }

    public static double MemoryLoadPercent()
    {
        var status = new MemoryStatusEx();
        return GlobalMemoryStatusEx(ref status) ? status.MemoryLoad : 0;
    }

    public static ulong TotalPhysicalMemoryBytes()
    {
        var status = new MemoryStatusEx();
        return GlobalMemoryStatusEx(ref status) ? status.TotalPhysical : 0;
    }

    private static ulong ToUInt64(FileTime value) => ((ulong)value.High << 32) | value.Low;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemTimes(out FileTime idle, out FileTime kernel, out FileTime user);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { public uint Low; public uint High; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MemoryStatusEx
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhysical;
        public ulong AvailablePhysical;
        public ulong TotalPageFile;
        public ulong AvailablePageFile;
        public ulong TotalVirtual;
        public ulong AvailableVirtual;
        public ulong AvailableExtendedVirtual;
        public MemoryStatusEx() { Length = (uint)Marshal.SizeOf<MemoryStatusEx>(); }
    }
}

internal sealed record CliOptions(string Command, Dictionary<string, string> Values)
{
    public string? Get(string key) => Values.GetValueOrDefault(key);
    public static CliOptions Parse(string[] args)
    {
        if (args.Length > 0 && args[0] is "--help" or "-h") return new CliOptions("help", new Dictionary<string, string>());
        var command = args.Length > 0 && !args[0].StartsWith('-') ? args[0].ToLowerInvariant() : "interactive";
        var start = args.Length > 0 && !args[0].StartsWith('-') ? 1 : 0;
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = start; index < args.Length; index++)
        {
            if (!args[index].StartsWith("--", StringComparison.Ordinal)) continue;
            var key = args[index][2..];
            if (index + 1 >= args.Length || args[index + 1].StartsWith("--", StringComparison.Ordinal)) throw new InvalidOperationException($"Option --{key} requires a value.");
            values[key] = args[++index];
        }
        return new CliOptions(command, values);
    }
}

internal sealed record AgentConfig(string Server, string DeviceId, string AgentSecret, int IntervalSeconds)
{
    public static AgentConfig Create(string server, string deviceId, string secret, int interval) => new(server, deviceId, secret, Math.Max(15, interval));
}
internal sealed record EmbeddedEnrollment(string Server, string Token);
internal sealed record StoredAgentConfig(string Server, string DeviceId, string ProtectedAgentSecret, int IntervalSeconds, DateTimeOffset EnrolledAt);
internal sealed record EnrollmentResponse(string DeviceId, string AgentSecret, int IntervalSeconds);
internal sealed record ApiError(string Error);
internal sealed record RemoteSupportBootstrap(RemoteProviderSet Providers);
internal sealed record RemoteProviderSet(RemoteProviderBootstrap Rustdesk, RemoteProviderBootstrap Rdp);
internal sealed record RemoteProviderBootstrap(bool Enabled, string? DisabledReason, string AssetUrl, string? Server, string? IdServer, string? RelayServer, string? Key, RemoteProviderCurrent? Current);
internal sealed record RemoteProviderCurrent(string ExternalId, string Status, DateTimeOffset? LastVerifiedAt);
internal sealed record RemoteProviderReport(string Provider, string ExternalId, string Status, string? Secret, string? Error, string? Version);
internal sealed record TaskEnvelope(List<AgentTask> Tasks);
internal sealed record AgentTask(string Id, string Action, JsonElement Parameters, DateTimeOffset CreatedAt);
internal sealed record EnrollmentPayload(string Hostname, string DisplayName, string Role, string OperatingSystem, string OsVersion, string Manufacturer, string Model, string SerialNumber, string Cpu, int MemoryGb, int DiskCapacityGb, double DiskUsedPercent, string IpAddress, string LastLoggedInUser, string AgentVersion, long UptimeMinutes);
internal sealed record CheckInPayload(double Cpu, double Memory, double DiskUsedPercent, int DiskCapacityGb, int LatencyMs, long UptimeMinutes, bool PendingReboot, string AgentVersion, string IpAddress, string LastLoggedInUser, HardwarePayload Hardware, List<SoftwarePayload> Software);
internal sealed record HardwarePayload(string BiosVersion, string? TpmVersion, int CpuCores, string MacAddress);
internal sealed record SoftwarePayload(string Name, string Version, string Vendor);
