# LabFlow API (ASP.NET Core). Build context: the LabFlow repo (LABFLOW_DIR);
# this file lives in Control Panel so the app repo isn't touched while it's
# being developed.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/LabFlow.Api/LabFlow.Api.csproj src/LabFlow.Api/
RUN dotnet restore src/LabFlow.Api/LabFlow.Api.csproj
COPY src ./src
RUN dotnet publish src/LabFlow.Api/LabFlow.Api.csproj -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
ENV ASPNETCORE_URLS=http://+:8080
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "LabFlow.Api.dll"]
