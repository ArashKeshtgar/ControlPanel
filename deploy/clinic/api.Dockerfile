# The API of a clinic application whose React app is served separately (PharmaFlow, FinancePowerApp): the same
# image for each, the project named by APP. Build context: that application's repo.
#   docker build --build-arg APP=PharmaFlow -f deploy/clinic/api.Dockerfile ../PharmaFlow
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG APP
WORKDIR /src
COPY src/${APP}.Api/${APP}.Api.csproj src/${APP}.Api/
RUN dotnet restore src/${APP}.Api/${APP}.Api.csproj
COPY src ./src
RUN dotnet publish src/${APP}.Api/${APP}.Api.csproj -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
ARG APP
WORKDIR /app
COPY --from=build /out .
# ASP.NET's own place for the Data Protection keys (sign-in cookies), made here so a volume mounted on it belongs to
# the app user: without one, every restart would sign everyone out.
RUN mkdir -p /home/app/.aspnet/DataProtection-Keys && chown -R app:app /home/app/.aspnet
ENV ASPNETCORE_URLS=http://+:8080 \
    APP_DLL=${APP}.Api.dll
USER app
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec dotnet \"$APP_DLL\" \"$@\"", "--"]
