import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ProjectsModule } from '../projects/projects.module';
import { AssistantController } from './assistant.controller';
import { ANTHROPIC_CLIENT, AssistantService } from './assistant.service';

// The assistant is optional: without ANTHROPIC_API_KEY the rest of
// core-api runs normally and POST /assistant/ask answers 503.
@Module({
  imports: [ConfigModule, ProjectsModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    {
      provide: ANTHROPIC_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const apiKey = config.get<string>('ANTHROPIC_API_KEY');
        return apiKey ? new Anthropic({ apiKey }) : null;
      },
    },
  ],
})
export class AssistantModule {}
