import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'droffice' })
  @IsString()
  @MinLength(1)
  key!: string;

  @ApiProperty({ example: 'DrOffice' })
  @IsString()
  @MinLength(1)
  displayName!: string;

  @ApiProperty({ example: 'Clinical' })
  @IsString()
  @MinLength(1)
  category!: string;

  @ApiProperty({ example: 'http://localhost:4003' })
  @IsString()
  adapterBaseUrl!: string;
}

export class UpdateProjectDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ required: false, example: 'http://localhost:4003' })
  @IsOptional()
  @IsString()
  adapterBaseUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
