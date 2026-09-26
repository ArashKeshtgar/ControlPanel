import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';

// Thin wrapper over a single mssql connection pool, shared across the app
// via Nest's DI container — every repository gets the same pool instead of
// opening a new connection per query. Uses SQL Server authentication (a
// dedicated controlpanel_svc login) rather than Windows-integrated auth —
// the latter needs the native msnodesqlv8 driver, which requires a C++
// build toolchain to compile; SQL auth works with the pure-JS tedious
// driver mssql ships by default, no native compilation needed.
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool!: sql.ConnectionPool;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    if (!this.config.get<string>('DB_PASSWORD')) {
      throw new Error('DB_PASSWORD must be set (see services/core-api/.env.example).');
    }
    this.pool = await new sql.ConnectionPool({
      server: this.config.get<string>('DB_SERVER', 'localhost'),
      database: this.config.get<string>('DB_NAME', 'ControlPanelDb'),
      user: this.config.get<string>('DB_USER', 'controlpanel_svc'),
      password: this.config.get<string>('DB_PASSWORD'),
      options: {
        trustServerCertificate: true,
        enableArithAbort: true,
      },
    }).connect();
  }

  async onModuleDestroy() {
    await this.pool?.close();
  }

  request(): sql.Request {
    return this.pool.request();
  }
}
