FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS windows-agent-build

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=true \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    NUGET_XMLDOC_MODE=skip

WORKDIR /source
COPY agent/windows/OpsPilot.Agent.csproj ./
COPY agent/windows/app.manifest ./
RUN dotnet restore OpsPilot.Agent.csproj -r win-x64
COPY agent/windows/Program.cs ./
RUN dotnet publish OpsPilot.Agent.csproj -c Release -r win-x64 --self-contained true --no-restore -o /agent-output \
    -p:PublishSingleFile=true -p:PublishTrimmed=false -p:IncludeNativeLibrariesForSelfExtract=true \
    && cd /agent-output && sha256sum opspilot-agent-windows-x64.exe > opspilot-agent-windows-x64.exe.sha256

FROM rustdesk/rustdesk-server:1.1.15 AS rustdesk-server

FROM node:22-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NO_UPDATE_NOTIFIER=1

ARG RUSTDESK_CLIENT_URL="https://github.com/rustdesk/rustdesk/releases/download/1.4.9/rustdesk-1.4.9-x86_64.exe"
ARG RUSTDESK_CLIENT_SHA256="eaedeb0088e687bf46f7c46a9c6ea5493ce51f3134dfd6acbedb47b5b9136274"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN mkdir -p public/downloads remote/packages \
    && curl -fL "$RUSTDESK_CLIENT_URL" -o remote/packages/rustdesk-windows-x64.exe \
    && echo "$RUSTDESK_CLIENT_SHA256  remote/packages/rustdesk-windows-x64.exe" | sha256sum -c -
COPY --from=windows-agent-build /agent-output/opspilot-agent-windows-x64.exe ./public/downloads/opspilot-agent-windows-x64.exe
COPY --from=windows-agent-build /agent-output/opspilot-agent-windows-x64.exe.sha256 ./public/downloads/opspilot-agent-windows-x64.exe.sha256
RUN node scripts/run-private-cli.mjs prisma generate && npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NO_UPDATE_NOTIFIER=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates gosu openssl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app /app
COPY --from=rustdesk-server /usr/bin/hbbs /usr/local/bin/hbbs
COPY --from=rustdesk-server /usr/bin/hbbr /usr/local/bin/hbbr
RUN npm prune --omit=dev --no-audit --no-fund \
    && mkdir -p /data /rustdesk /backups /app/.next/cache \
    && chown -R node:node /data /rustdesk /app/.next/cache \
    && chmod 0755 /app/scripts/container-entrypoint.sh /usr/local/bin/hbbs /usr/local/bin/hbbr

EXPOSE 3000 21115 21116 21117 21118 21119
VOLUME ["/data", "/rustdesk"]
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/scripts/container-entrypoint.sh"]
