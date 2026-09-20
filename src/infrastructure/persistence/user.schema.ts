import { Schema } from 'mongoose';
import { Gender, LinkedProvider, Session } from '../../domain/auth';
export interface UserRecord {
  _id: string;
  identityKeys: string[];
  providers: LinkedProvider[];
  username: string | null;
  displayName: string;
  gender: Gender;
  email: string | null;
  avatarUrl: string | null;
  passwordHash?: string;
  sessions: Session[];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}
const ProviderSchema = new Schema(
  {
    type: { type: String, required: true },
    providerUserId: { type: String, required: true },
    email: { type: String, default: null },
    emailVerified: { type: Boolean, default: false },
    linkedAt: { type: Date, required: true },
  },
  { _id: false },
);
const SessionSchema = new Schema(
  {
    id: { type: String, required: true },
    createdAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { _id: false },
);
export const UserSchema = new Schema<UserRecord>(
  {
    _id: { type: String, required: true },
    identityKeys: { type: [String], required: true },
    providers: { type: [ProviderSchema], required: true },
    username: { type: String, default: null },
    displayName: { type: String, required: true },
    gender: { type: String, default: 'unspecified' },
    email: { type: String, default: null },
    avatarUrl: { type: String, default: null },
    passwordHash: { type: String, select: false },
    sessions: { type: [SessionSchema], default: [] },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'users', versionKey: false },
);
// One unique multikey index over canonical identity tuples. No cross-element compound pairing.
UserSchema.index(
  { identityKeys: 1 },
  { unique: true, name: 'unique_provider_identity' },
);
