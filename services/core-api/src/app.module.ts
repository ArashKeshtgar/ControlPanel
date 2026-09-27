import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { AssistantModule } from './assistant/assistant.module';
import { ServicesModule } from './services/services.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    ProjectsModule,
    AssistantModule,
    ServicesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
