FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS windows-agent-build

WORKDIR /source
COPY agent/windows/OpsPilot.Agent.csproj ./
COPY agent/windows/app.manifest ./
RUN dotnet restore OpsPilot.Agent.csproj -r win-x64
COPY agent/windows/Program.cs ./
RUN dotnet publish OpsPilot.Agent.csproj -c Release -r win-x64 --self-contained true --no-restore -o /agent-output \
    -p:PublishSingleFile=true -p:PublishTrimmed=false -p:IncludeNativeLibrariesForSelfExtract=true \
    && cd /agent-output && sha256sum opspilot-agent-windows-x64.exe > opspilot-agent-windows-x64.exe.sha256

FROM node:22-bookworm-slim AS build

ARG RUSTDESK_CLIENT_URL="https://github.com/rustdesk/rustdesk/releases/download/1.4.9/rustdesk-1.4.9-x86_64.exe"
ARG RUSTDESK_CLIENT_SHA256="eaedeb0088e687bf46f7c46a9c6ea5493ce51f3134dfd6acbedb47b5b9136274"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN mkdir -p public/downloads remote/packages \
    && curl -fL "$RUSTDESK_CLIENT_URL" -o remote/packages/rustdesk-windows-x64.exe \
    && echo "$RUSTDESK_CLIENT_SHA256  remote/packages/rustdesk-windows-x64.exe" | sha256sum -c -
COPY --from=windows-agent-build /agent-output/opspilot-agent-windows-x64.exe ./public/downloads/opspilot-agent-windows-x64.exe
COPY --from=windows-agent-build /agent-output/opspilot-agent-windows-x64.exe.sha256 ./public/downloads/opspilot-agent-windows-x64.exe.sha256
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN npm prune --omit=dev \
    && mkdir -p /data /app/.next/cache \
    && chown -R node:node /data /app/.next/cache

USER node
EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npm run db:sync && npm start"]
