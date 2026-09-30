import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorDto } from './auth.dto';
import { HealthResponseDto } from './health.dto';
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly mongo: Connection) {}
  @Get()
  @ApiOperation({
    summary: 'Check application and database availability',
    description: 'Pings MongoDB. No authentication is required.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiResponse({
    status: 503,
    description: 'MongoDB is disconnected or its ping failed.',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Per-IP request limit exceeded.',
    type: ErrorDto,
  })
  async health(): Promise<HealthResponseDto> {
    try {
      if (this.mongo.readyState !== 1 || !this.mongo.db)
        throw new Error('Database unavailable');
      await this.mongo.db.command({ ping: 1 }, { timeoutMS: 2000 });
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok', database: 'up' };
  }
}
