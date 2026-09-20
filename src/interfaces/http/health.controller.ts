import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly mongo: Connection) {}
  @Get()
  @ApiOkResponse({ schema: { example: { status: 'ok', mongo: 'up' } } })
  health() {
    if (this.mongo.readyState !== 1) throw new ServiceUnavailableException();
    return { status: 'ok', mongo: 'up' };
  }
}
