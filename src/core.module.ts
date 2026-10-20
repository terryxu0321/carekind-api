// Shared infrastructure for every feature module: database, config, audit, auth and the global guard.
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider } from './auth/auth-provider.js';
import { AuthGuard } from './auth/auth.guard.js';
import { InviteService } from './auth/invite.service.js';
import { LocalAuthProvider } from './auth/local-auth.provider.js';
import { AuditService } from './common/audit.service.js';
import { APP_CONFIG, DATABASE } from './common/tokens.js';
import type { AppConfig } from './config/app-config.js';
import type { Database } from './db/database.js';

export interface CoreOptions {
	db: Database;
	config: AppConfig;
}

@Global()
@Module({})
export class CoreModule {
	static forRoot(options: CoreOptions): DynamicModule {
		return {
			module: CoreModule,
			providers: [
				{ provide: DATABASE, useValue: options.db },
				{ provide: APP_CONFIG, useValue: options.config },
				{
					provide: JwtService,
					useValue: new JwtService({ secret: options.config.jwtSecret }),
				},
				{ provide: AuthProvider, useClass: LocalAuthProvider },
				{ provide: APP_GUARD, useClass: AuthGuard },
				AuditService,
				InviteService,
			],
			exports: [DATABASE, APP_CONFIG, JwtService, AuthProvider, AuditService, InviteService],
		};
	}
}
