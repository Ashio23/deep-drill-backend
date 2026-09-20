import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly mongo: Connection) {}
  @Get()
  @ApiOkResponse({ schema: { example: { status: 'ok', database: 'up' } } })
  async health() {
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
