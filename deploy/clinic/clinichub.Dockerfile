# ClinicHub: sign-in (OpenID Connect) and the clinics' front desk, care and billing. One image: the React app is
# built and served by the API from wwwroot, so the pages, /connect and /.well-known share one origin (the issuer).
# Build context: the ClinicHub repo (CLINICHUB_DIR).
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/ClinicHub.Api/ClinicHub.Api.csproj src/ClinicHub.Api/
RUN dotnet restore src/ClinicHub.Api/ClinicHub.Api.csproj
COPY src ./src
RUN dotnet publish src/ClinicHub.Api/ClinicHub.Api.csproj -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
COPY --from=web /web/dist ./wwwroot
# Data Protection keys (two-factor secrets and clinic connection strings are encrypted with them): a volume, backed up.
RUN mkdir /keys && chown app:app /keys
ENV ASPNETCORE_URLS=http://+:8080 \
    DataProtection__KeysPath=/keys
VOLUME /keys
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "ClinicHub.Api.dll"]
