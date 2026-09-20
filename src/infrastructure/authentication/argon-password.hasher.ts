import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PasswordHasher } from '../../application/ports';
@Injectable()
export class ArgonPasswordHasher implements PasswordHasher, OnModuleInit {
  private dummyHash = '';
  async onModuleInit() {
    this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
  }
  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
  async verify(hash: string | undefined, password: string): Promise<boolean> {
    const valid = await argon2.verify(hash ?? this.dummyHash, password);
    return !!hash && valid;
  }
}
