import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, type IAppConfig } from './config/configuration.js';

const app = await NestFactory.create(AppModule);
configureApp(app);
await app.listen(app.get<IAppConfig>(APP_CONFIG).port);
