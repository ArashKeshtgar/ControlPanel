import {
  BadRequestException, Body, Controller, DefaultValuePipe, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/jwt.strategy';
import { SERVICE_NAME_PATTERN } from './orchestrator';
import { ServicesService } from './services.service';

export class ServiceActionDto {
  @ApiProperty({ required: false, description: 'Stop and restart need the service name repeated here.' })
  @IsOptional()
  @IsString()
  @MaxLength(63)
  confirm?: string;
}

// Anyone signed in can see which services are up. Starting, stopping,
// restarting and reading logs is Admin-only and audited.
@ApiTags('services')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('services')
export class ServicesController {
  constructor(private services: ServicesService) {}

  @Get()
  list() {
    return this.services.list();
  }

  @Get('audit')
  @Roles('Admin')
  audit(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.services.auditLog(limit);
  }

  @Post(':name/start')
  @Roles('Admin')
  @HttpCode(200)
  start(@Req() req: { user: JwtPayload }, @Param('name') name: string) {
    return this.services.act(req.user, checkName(name), 'start');
  }

  @Post(':name/stop')
  @Roles('Admin')
  @HttpCode(200)
  stop(@Req() req: { user: JwtPayload }, @Param('name') name: string, @Body() dto: ServiceActionDto) {
    return this.services.act(req.user, confirmed(name, dto), 'stop');
  }

  @Post(':name/restart')
  @Roles('Admin')
  @HttpCode(200)
  restart(@Req() req: { user: JwtPayload }, @Param('name') name: string, @Body() dto: ServiceActionDto) {
    return this.services.act(req.user, confirmed(name, dto), 'restart');
  }

  @Get(':name/logs')
  @Roles('Admin')
  logs(
    @Req() req: { user: JwtPayload },
    @Param('name') name: string,
    @Query('tail', new DefaultValuePipe(200), ParseIntPipe) tail: number,
  ) {
    return this.services.logs(req.user, checkName(name), tail);
  }
}

function checkName(name: string): string {
  if (!SERVICE_NAME_PATTERN.test(name)) throw new BadRequestException('Invalid service name.');
  return name;
}

// Taking a service down is the one action here that hurts if it's a
// misclick, so the API itself (not just the UI) wants the name typed back.
function confirmed(name: string, dto: ServiceActionDto): string {
  checkName(name);
  if (dto?.confirm !== name) {
    throw new BadRequestException(`Confirm by sending {"confirm": "${name}"}.`);
  }
  return name;
}
