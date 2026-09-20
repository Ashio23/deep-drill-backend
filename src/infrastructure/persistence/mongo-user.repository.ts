import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  AuthError,
  ExternalIdentity,
  LocalRegistration,
  Provider,
  Session,
  User,
  UserRepository,
} from '../../domain/auth';
import { UserRecord } from './user.schema';
const key = (provider: Provider, id: string) => JSON.stringify([provider, id]);
function duplicate(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
@Injectable()
export class MongoUserRepository implements UserRepository, OnModuleInit {
  constructor(@InjectModel('User') private readonly model: Model<UserRecord>) {}
  async onModuleInit() {
    await this.model.init();
  }
  private domain(record: UserRecord): User {
    return {
      id: record._id,
      providers: record.providers,
      username: record.username,
      displayName: record.displayName,
      gender: record.gender,
      email: record.email,
      avatarUrl: record.avatarUrl,
      passwordHash: record.passwordHash,
      sessions: record.sessions,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastLoginAt: record.lastLoginAt,
    };
  }
  private async persist<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('USER_PERSISTENCE_FAILURE', 503);
    }
  }
  async socialUser(identity: ExternalIdentity): Promise<User> {
    return this.persist(async () => {
      const identityKey = key(identity.provider, identity.providerUserId),
        now = new Date();
      let record: UserRecord | null;
      try {
        record = await this.model
          .findOneAndUpdate(
            { identityKeys: identityKey },
            {
              $setOnInsert: {
                _id: randomUUID(),
                identityKeys: [identityKey],
                providers: [
                  {
                    type: identity.provider,
                    providerUserId: identity.providerUserId,
                    email: identity.email ?? null,
                    emailVerified: identity.emailVerified ?? false,
                    linkedAt: now,
                  },
                ],
                displayName:
                  identity.displayName?.trim().slice(0, 60) || 'Pilot',
                email: identity.email ?? null,
                avatarUrl: identity.avatarUrl ?? null,
                gender: 'unspecified',
                username: null,
                sessions: [],
              },
            },
            {
              upsert: true,
              returnDocument: 'after',
              setDefaultsOnInsert: true,
            },
          )
          .lean();
      } catch (error) {
        if (!duplicate(error)) throw error;
        record = await this.model.findOne({ identityKeys: identityKey }).lean();
      }
      if (!record) throw new AuthError('USER_PERSISTENCE_FAILURE', 503);
      const changes: Record<string, unknown> = {};
      if (identity.displayName?.trim())
        changes.displayName = identity.displayName.trim().slice(0, 60);
      if (identity.avatarUrl) changes.avatarUrl = identity.avatarUrl;
      if (identity.email) {
        changes.email = identity.email;
        changes['providers.$[provider].email'] = identity.email;
        changes['providers.$[provider].emailVerified'] =
          identity.emailVerified ?? false;
      }
      if (Object.keys(changes).length)
        record = await this.model
          .findOneAndUpdate(
            { _id: record._id },
            { $set: changes },
            {
              returnDocument: 'after',
              ...(identity.email
                ? {
                    arrayFilters: [
                      {
                        'provider.type': identity.provider,
                        'provider.providerUserId': identity.providerUserId,
                      },
                    ],
                  }
                : {}),
            },
          )
          .lean();
      if (!record) throw new AuthError('USER_PERSISTENCE_FAILURE', 503);
      return this.domain(record);
    });
  }
  async findLocal(username: string): Promise<User | null> {
    return this.persist(async () => {
      const record = await this.model
        .findOne({ identityKeys: key(Provider.Local, username) })
        .select('+passwordHash')
        .lean();
      return record ? this.domain(record) : null;
    });
  }
  async createLocal(
    input: Omit<LocalRegistration, 'password'>,
    passwordHash: string,
  ): Promise<User> {
    return this.persist(async () => {
      try {
        const record = await this.model.create({
          _id: randomUUID(),
          identityKeys: [key(Provider.Local, input.username)],
          providers: [
            {
              type: Provider.Local,
              providerUserId: input.username,
              email: null,
              emailVerified: false,
              linkedAt: new Date(),
            },
          ],
          username: input.username,
          displayName: input.displayName,
          gender: input.gender ?? 'unspecified',
          passwordHash,
        });
        return this.domain(record.toObject());
      } catch (error) {
        if (duplicate(error))
          throw new AuthError('AUTH_REGISTRATION_FAILED', 409);
        throw error;
      }
    });
  }
  async appendSession(
    userId: string,
    session: Session,
    limit: number,
  ): Promise<void> {
    await this.persist(async () => {
      const result = await this.model.updateOne(
        { _id: userId },
        [
          {
            $set: {
              lastLoginAt: session.createdAt,
              updatedAt: session.createdAt,
              sessions: {
                $slice: [
                  {
                    $concatArrays: [
                      {
                        $filter: {
                          input: { $ifNull: ['$sessions', []] },
                          as: 's',
                          cond: {
                            $and: [
                              { $eq: ['$$s.revokedAt', null] },
                              { $gt: ['$$s.expiresAt', session.createdAt] },
                            ],
                          },
                        },
                      },
                      { $literal: [session] },
                    ],
                  },
                  -limit,
                ],
              },
            },
          },
        ],
        { updatePipeline: true },
      );
      if (result.matchedCount !== 1)
        throw new AuthError('AUTH_INVALID_SESSION');
    });
  }
  async requireActiveSession(
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await this.persist(async () => {
      const result = await this.model.updateOne(
        {
          _id: userId,
          sessions: {
            $elemMatch: {
              id: sessionId,
              revokedAt: null,
              expiresAt: { $gt: now },
            },
          },
        },
        { $set: { 'sessions.$.lastSeenAt': now } },
      );
      if (result.matchedCount !== 1)
        await this.sessionFailure(userId, sessionId);
    });
  }
  private async sessionFailure(
    userId: string,
    sessionId: string,
  ): Promise<never> {
    const revoked = await this.model.exists({
      _id: userId,
      sessions: { $elemMatch: { id: sessionId, revokedAt: { $ne: null } } },
    });
    throw new AuthError(
      revoked ? 'AUTH_SESSION_REVOKED' : 'AUTH_INVALID_SESSION',
    );
  }
  async revokeSession(
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await this.persist(async () => {
      const result = await this.model.updateOne(
        {
          _id: userId,
          sessions: {
            $elemMatch: {
              id: sessionId,
              revokedAt: null,
              expiresAt: { $gt: now },
            },
          },
        },
        { $set: { 'sessions.$.revokedAt': now } },
      );
      if (result.matchedCount !== 1)
        await this.sessionFailure(userId, sessionId);
    });
  }
}
