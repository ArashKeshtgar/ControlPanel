import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';
import { AssistantService } from './assistant.service';

export class AskDto {
  @ApiProperty({ example: 'Which projects are offline, and which applications need a follow-up?' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  question!: string;
}

// Any signed-in user (Admin or Viewer) may ask: the assistant can only read.
@ApiTags('assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('assistant')
export class AssistantController {
  constructor(private assistant: AssistantService) {}

  @Post('ask')
  @HttpCode(200)
  ask(@Req() req: { user: JwtPayload }, @Body() dto: AskDto) {
    return this.assistant.ask(req.user.sub, dto.question);
  }
}
