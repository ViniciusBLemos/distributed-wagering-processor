
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { WalletsService } from './wallets.service.js';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
  ) {}

  @Post()
  create(@Body() body: unknown) {
    return this.walletsService.create(body);
  }

  @Get(':walletId')
  findOne(@Param('walletId') walletId: string) {
    return this.walletsService.findOne(walletId);
  }

  @Get(':walletId/ledger')
  listLedger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.walletsService.listLedger(
      walletId,
      cursor,
      limit,
    );
  }

  @Post(':walletId/reconciliation')
  reconcile(@Param('walletId') walletId: string) {
    return this.walletsService.reconcile(walletId);
  }
}
