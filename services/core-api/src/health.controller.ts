import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

// Liveness only, for the container healthcheck: no auth, no database call,
// nothing about the system in the answer.
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { ok: true };
  }
}
