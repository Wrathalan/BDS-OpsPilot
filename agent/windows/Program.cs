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

Console.OutputEncoding = Encoding.UTF8;
return await AgentProgram.RunAsync(args);

internal static class AgentProgram
{
    private const string AgentVersion = "0.3.0";

    public static async Task<int> RunAsync(string[] args)
    {
        try
        {
            Console.Title = $"OpsPilot Endpoint Agent {AgentVersion}";
            var options = CliOptions.Parse(args);
            return options.Command switch
            {
                "enroll" => await EnrollCommandAsync(options, interactive: false),
                "once" => await OnceCommandAsync(options),
                "run" => await RunCommandAsync(options),
                "help" or "--help" or "-h" => PrintHelp(),
                "interactive" => await InteractiveAsync(options),
                _ => throw new InvalidOperationException($"Unknown command '{options.Command}'. Run with --help for usage."),
            };
        }
        catch (OperationCanceledException)
        {
            Console.WriteLine("Agent stopped.");
            return 0;
        }
        catch (Exception error)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.Error.WriteLine($"Error: {error.Message}");
            Console.ResetColor();
            if (args.Length == 0)
            {
                Console.WriteLine("Press Enter to close.");
                Console.ReadLine();
            }
            return 1;
        }
    }

    private static int PrintHelp()
    {
        Console.WriteLine($"""
            OpsPilot Endpoint Agent {AgentVersion}

            Double-click the executable for guided self-enrollment.

            Commands:
              enroll --server <url> --token <one-time-token> [--data-dir <path>]
              once [--data-dir <path>]
              run [--data-dir <path>]

            The agent runs in the foreground. It does not install a service,
            scheduled task, startup entry, remote shell, or arbitrary command runner.
            """);
        return 0;
    }

    private static async Task<int> InteractiveAsync(CliOptions options)
    {
        PrintBanner();
        if (AgentConfigStore.TryLoad(options.Get("data-dir"), out var existing))
        {
            Console.WriteLine($"Existing enrollment found for device {existing.DeviceId}.");
            Console.Write("Press Enter to start monitoring, or type R to re-enroll: ");
            if (!string.Equals(Console.ReadLine()?.Trim(), "r", StringComparison.OrdinalIgnoreCase))
                return await RunAgentAsync(existing, once: false);
        }

        var result = await EnrollCommandAsync(options, interactive: true);
        if (result != 0) return result;

        Console.Write("Start continuous foreground monitoring now? [Y/n]: ");
        var answer = Console.ReadLine()?.Trim();
        if (string.Equals(answer, "n", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine("Enrollment is complete. Run this executable again to start monitoring.");
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
            return 0;
        }

        var config = AgentConfigStore.Load(options.Get("data-dir"));
        return await RunAgentAsync(config, once: false);
    }

    private static async Task<int> EnrollCommandAsync(CliOptions options, bool interactive)
    {
        var server = options.Get("server") ?? Environment.GetEnvironmentVariable("OPSPILOT_SERVER");
        if (string.IsNullOrWhiteSpace(server) && interactive)
        {
            Console.Write("OpsPilot server URL [http://127.0.0.1:3000]: ");
            server = Console.ReadLine()?.Trim();
        }
        server = NormalizeServer(string.IsNullOrWhiteSpace(server) ? "http://127.0.0.1:3000" : server);

        var token = options.Get("token") ?? Environment.GetEnvironmentVariable("OPSPILOT_ENROLLMENT_TOKEN");
        if (string.IsNullOrWhiteSpace(token))
        {
            if (!interactive && Console.IsInputRedirected) throw new InvalidOperationException("Provide --token or OPSPILOT_ENROLLMENT_TOKEN.");
            Console.Write("One-time enrollment token: ");
            token = ReadSecret();
        }
        if (string.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("An enrollment token is required.");

        if (new Uri(server).Scheme == Uri.UriSchemeHttp && !new Uri(server).IsLoopback)
        {
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("Warning: this server uses unencrypted HTTP. Use HTTPS before enrolling across a network.");
            Console.ResetColor();
        }

        Console.WriteLine("Collecting Windows host inventory...");
        var enrollment = await HostInventory.CreateEnrollmentAsync(AgentVersion);
        using var client = new AgentClient(server, AgentVersion);
        var response = await client.EnrollAsync(token, enrollment);
        var config = AgentConfig.Create(server, response.DeviceId, response.AgentSecret, response.IntervalSeconds);
        var configPath = AgentConfigStore.Save(config, options.Get("data-dir"));
        await client.CheckInAsync(config.AgentSecret, await HostInventory.CreateCheckInAsync(AgentVersion));

        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine($"Enrolled {enrollment.Hostname} as {response.DeviceId}.");
        Console.ResetColor();
        Console.WriteLine($"Initial authenticated check-in accepted. Protected state saved to {configPath}");
        return 0;
    }

    private static async Task<int> OnceCommandAsync(CliOptions options)
    {
        PrintBanner();
        return await RunAgentAsync(AgentConfigStore.Load(options.Get("data-dir")), once: true);
    }

    private static async Task<int> RunCommandAsync(CliOptions options)
    {
        PrintBanner();
        return await RunAgentAsync(AgentConfigStore.Load(options.Get("data-dir")), once: false);
    }

    private static async Task<int> RunAgentAsync(AgentConfig config, bool once)
    {
        using var client = new AgentClient(config.Server, AgentVersion);
        if (!once)
        {
            Console.WriteLine("Foreground monitoring started. Press Ctrl+C to stop.");
            Console.WriteLine("No service, scheduled task, or startup entry is installed.");
        }

        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; cancellation.Cancel(); };
        do
        {
            try
            {
                var payload = await HostInventory.CreateCheckInAsync(AgentVersion);
                await client.CheckInAsync(config.AgentSecret, payload, cancellation.Token);
                Console.WriteLine($"[{DateTimeOffset.Now:O}] Check-in accepted: CPU {payload.Cpu:0.0}% · memory {payload.Memory:0.0}% · disk {payload.DiskUsedPercent:0.0}%");
                await client.ProcessTasksAsync(config.AgentSecret, cancellation.Token);
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { break; }
            catch (Exception error)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.Error.WriteLine($"[{DateTimeOffset.Now:O}] {error.Message}");
                Console.ResetColor();
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

    private static string ReadSecret()
    {
        if (Console.IsInputRedirected) return Console.ReadLine()?.Trim() ?? "";
        var value = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) { Console.WriteLine(); return value.ToString(); }
            if (key.Key == ConsoleKey.Backspace && value.Length > 0) { value.Length--; Console.Write("\b \b"); continue; }
            if (!char.IsControl(key.KeyChar)) { value.Append(key.KeyChar); Console.Write('*'); }
        }
    }

    private static void PrintBanner()
    {
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine($"OpsPilot Endpoint Agent {AgentVersion}");
        Console.ResetColor();
    }
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

    public async Task ProcessTasksAsync(string secret, CancellationToken cancellation = default)
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
                await CheckInAsync(secret, await HostInventory.CreateCheckInAsync("0.3.0"), cancellation);
                Console.WriteLine($"Completed allowlisted task {task.Action} ({task.Id}).");
            }
            catch (Exception error)
            {
                status = "failed";
                output = "";
                failureReason = error.Message;
            }
            _ = await PostAsync<JsonElement>($"/api/agent/tasks/{Uri.EscapeDataString(task.Id)}/complete", new { status, output, failureReason }, secret, cancellation);
        }
    }

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
        var client = new HttpClient { BaseAddress = new Uri(server), Timeout = TimeSpan.FromSeconds(45) };
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

    private static (string IpAddress, string MacAddress) PrimaryNetwork()
    {
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces().Where(item => item.OperationalStatus == OperationalStatus.Up && item.NetworkInterfaceType != NetworkInterfaceType.Loopback))
        {
            var address = adapter.GetIPProperties().UnicastAddresses.FirstOrDefault(item => item.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(item.Address));
            if (address is not null) return (address.Address.ToString(), string.Join(":", adapter.GetPhysicalAddress().GetAddressBytes().Select(value => value.ToString("X2"))));
        }
        return ("127.0.0.1", "Not reported");
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
internal sealed record StoredAgentConfig(string Server, string DeviceId, string ProtectedAgentSecret, int IntervalSeconds, DateTimeOffset EnrolledAt);
internal sealed record EnrollmentResponse(string DeviceId, string AgentSecret, int IntervalSeconds);
internal sealed record ApiError(string Error);
internal sealed record TaskEnvelope(List<AgentTask> Tasks);
internal sealed record AgentTask(string Id, string Action, JsonElement Parameters, DateTimeOffset CreatedAt);
internal sealed record EnrollmentPayload(string Hostname, string DisplayName, string Role, string OperatingSystem, string OsVersion, string Manufacturer, string Model, string SerialNumber, string Cpu, int MemoryGb, int DiskCapacityGb, double DiskUsedPercent, string IpAddress, string LastLoggedInUser, string AgentVersion, long UptimeMinutes);
internal sealed record CheckInPayload(double Cpu, double Memory, double DiskUsedPercent, int DiskCapacityGb, int LatencyMs, long UptimeMinutes, bool PendingReboot, string AgentVersion, string IpAddress, string LastLoggedInUser, HardwarePayload Hardware, List<SoftwarePayload> Software);
internal sealed record HardwarePayload(string BiosVersion, string? TpmVersion, int CpuCores, string MacAddress);
internal sealed record SoftwarePayload(string Name, string Version, string Vendor);
