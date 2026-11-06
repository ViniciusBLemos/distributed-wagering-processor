import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

import { HttpAuditInterceptor } from './observability/http-audit.interceptor.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();
  app.useGlobalInterceptors(new HttpAuditInterceptor());
  
  await app.listen(Number(process.env.PORT ?? 3000));
}
await bootstrap();
