import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Get()
  list() {
    return this.projects.listWithStatus();
  }

  @Get('registry')
  registry() {
    return this.projects.listRegistry();
  }

  @Post()
  @Roles('Admin')
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto);
  }

  @Put(':id')
  @Roles('Admin')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProjectDto) {
    return this.projects.update(id, dto);
  }

  @Delete(':id')
  @Roles('Admin')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.projects.delete(id);
  }
}
