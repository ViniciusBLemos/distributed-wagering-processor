
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
} from '@nestjs/common';

import type { Response } from 'express';
import { WageringService } from './wagering.service.js';

@Controller('wagering')
export class WageringController {
  constructor(
    private readonly wageringService: WageringService,
  ) {}

  @Post('transactions')
  async submit(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.wageringService.submit(
      body,
      idempotencyKey,
    );

    response.status(
      result.status === 'REJECTED'
        ? 422
        : result.status === 'PENDING_REFERENCE'
          ? 202
          : 200,
    );

    return result;
  }

  @Get('transactions/:transactionId')
  findById(
    @Param('transactionId') transactionId: string,
  ) {
    return this.wageringService.findById(transactionId);
  }
}
