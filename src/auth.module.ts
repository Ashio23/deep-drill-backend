import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import {
  RegisterUseCase,
  SessionIssuer,
  SignInUseCase,
  SignOutUseCase,
  ValidateSessionUseCase,
} from './application/auth.use-cases';
import { Provider } from './domain/auth';
import { GoogleIdentityProvider } from './infrastructure/authentication/google.provider';
import { FacebookIdentityProvider } from './infrastructure/authentication/facebook.provider';
import { JwtTokenIssuer } from './infrastructure/authentication/jwt-token.issuer';
import { ArgonPasswordHasher } from './infrastructure/authentication/argon-password.hasher';
import { MongoUserRepository } from './infrastructure/persistence/mongo-user.repository';
import { UserSchema } from './infrastructure/persistence/user.schema';
import { AuthController } from './interfaces/http/auth.controller';
import { ActiveSessionGuard } from './interfaces/http/session.guard';
@Module({
  imports: [
    MongooseModule.forFeature([{ name: 'User', schema: UserSchema }]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    MongoUserRepository,
    GoogleIdentityProvider,
    FacebookIdentityProvider,
    JwtTokenIssuer,
    ArgonPasswordHasher,
    ActiveSessionGuard,
    {
      provide: SessionIssuer,
      inject: [MongoUserRepository, JwtTokenIssuer, ConfigService],
      useFactory: (
        users: MongoUserRepository,
        tokens: JwtTokenIssuer,
        c: ConfigService,
      ) =>
        new SessionIssuer(
          users,
          tokens,
          c.getOrThrow<number>('JWT_LIFETIME_SECONDS'),
          c.getOrThrow<number>('MAX_SESSIONS'),
        ),
    },
    {
      provide: SignInUseCase,
      inject: [
        MongoUserRepository,
        GoogleIdentityProvider,
        FacebookIdentityProvider,
        SessionIssuer,
        ArgonPasswordHasher,
      ],
      useFactory: (
        u: MongoUserRepository,
        g: GoogleIdentityProvider,
        f: FacebookIdentityProvider,
        s: SessionIssuer,
        p: ArgonPasswordHasher,
      ) =>
        new SignInUseCase(
          u,
          { [Provider.Google]: g, [Provider.Facebook]: f },
          s,
          p,
        ),
    },
    {
      provide: RegisterUseCase,
      inject: [MongoUserRepository, ArgonPasswordHasher, SessionIssuer],
      useFactory: (
        u: MongoUserRepository,
        p: ArgonPasswordHasher,
        s: SessionIssuer,
      ) => new RegisterUseCase(u, p, s),
    },
    {
      provide: ValidateSessionUseCase,
      inject: [MongoUserRepository, JwtTokenIssuer],
      useFactory: (u: MongoUserRepository, t: JwtTokenIssuer) =>
        new ValidateSessionUseCase(u, t),
    },
    {
      provide: SignOutUseCase,
      inject: [MongoUserRepository],
      useFactory: (u: MongoUserRepository) => new SignOutUseCase(u),
    },
  ],
  exports: [ActiveSessionGuard, ValidateSessionUseCase],
})
export class AuthModule {}
