
import { Controller, Get, Param } from '@nestjs/common';
import { WageringService } from './wagering.service.js';

@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly wageringService: WageringService,
  ) {}

  @Get(':providerId/wagering/transactions/:externalTransactionId')
  findByProvider(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId')
    externalTransactionId: string,
  ) {
    return this.wageringService.findByProvider(
      providerId,
      externalTransactionId,
    );
  }
}
