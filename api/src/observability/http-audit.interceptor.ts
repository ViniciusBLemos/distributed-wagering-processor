
import { randomUUID } from 'node:crypto';

import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';

import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

@Injectable()
export class HttpAuditInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const http = context.switchToHttp();

    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const header = request.headers['x-correlation-id'];

    const correlationId =
      typeof header === 'string' &&
      /^[a-zA-Z0-9._:-]{1,100}$/.test(header)
        ? header
        : randomUUID();

    response.setHeader('X-Correlation-Id', correlationId);

    const started = performance.now();

    const body =
      request.body &&
      typeof request.body === 'object' &&
      !Array.isArray(request.body)
        ? request.body as Record<string, unknown>
        : {};

    const log = (
      statusCode: number,
      result?: unknown,
    ) => {
      const resultData =
        result &&
        typeof result === 'object' &&
        !Array.isArray(result)
          ? result as Record<string, unknown>
          : {};

      const entry = {
        timestamp: new Date().toISOString(),
        level: statusCode >= 500 ? 'error' : 'info',
        event: 'http_request_completed',
        correlationId,
        method: request.method,
        path: request.path,
        statusCode,
        durationMs: Math.round(
          (performance.now() - started) * 100,
        ) / 100,
        ...(typeof body.providerId === 'string'
          ? { providerId: body.providerId }
          : {}),
        ...(typeof body.walletId === 'string'
          ? { walletId: body.walletId }
          : {}),
        ...(typeof request.params.walletId === 'string'
          ? { walletId: request.params.walletId }
          : {}),
        ...(typeof resultData.transactionId === 'string'
          ? { transactionId: resultData.transactionId }
          : {}),
        ...(typeof resultData.idempotentReplay === 'boolean'
          ? { idempotentReplay: resultData.idempotentReplay }
          : {}),
      };

      process.stdout.write(JSON.stringify(entry) + '\n');
    };

    return next.handle().pipe(
      tap({
        next: (result: unknown) => {
          log(response.statusCode, result);
        },
        error: (error: unknown) => {
          const statusCode =
            error instanceof HttpException
              ? error.getStatus()
              : 500;

          log(statusCode);
        },
      }),
    );
  }
}
