import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuditService } from './audit.service';
import { DockerOrchestrator } from './docker-orchestrator';
import { ORCHESTRATOR } from './orchestrator';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

// Service control is optional: without DOCKER_PROXY_URL (e.g. core-api run
// with npm on the host) the /services endpoints answer 503.
@Module({
  imports: [ConfigModule],
  controllers: [ServicesController],
  providers: [
    AuditService,
    ServicesService,
    {
      provide: ORCHESTRATOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('DOCKER_PROXY_URL');
        return url ? new DockerOrchestrator(url.replace(/\/+$/, '')) : null;
      },
    },
  ],
})
export class ServicesModule {}
