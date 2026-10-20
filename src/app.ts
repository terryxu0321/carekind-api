// Builds the Nest application. Used by main.ts (dev server) and by the tests (in-memory database).
import 'reflect-metadata';
import { type DynamicModule, type LogLevel, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from '@carekind/shared';
import { AuthController } from './auth/auth.controller.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { CoreModule, type CoreOptions } from './core.module.js';
import { OrgModule } from './org/org.module.js';
import { PlatformModule } from './platform/platform.module.js';

// Tech design §1: only the two local admin front ends may call the API from a browser (CORE-08).
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'];
// Register imports are small text files; this caps abuse without limiting real use.
const CSV_BODY_LIMIT = '2mb';

@Module({ controllers: [AuthController] })
class AuthModule {}

@Module({})
class AppModule {
	static register(options: CoreOptions): DynamicModule {
		return {
			module: AppModule,
			imports: [CoreModule.forRoot(options), AuthModule, PlatformModule, OrgModule],
		};
	}
}

export async function createApp(
	options: CoreOptions,
	logLevels: LogLevel[] = ['error', 'warn', 'log'],
): Promise<NestExpressApplication> {
	const app = await NestFactory.create<NestExpressApplication>(AppModule.register(options), {
		logger: logLevels,
	});
	app.setGlobalPrefix(API_PREFIX);
	app.enableCors({ origin: ALLOWED_ORIGINS });
	app.useBodyParser('text', { type: 'text/csv', limit: CSV_BODY_LIMIT });
	app.useGlobalFilters(new ApiExceptionFilter());
	return app;
}
