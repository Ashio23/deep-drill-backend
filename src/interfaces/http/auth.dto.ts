import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Gender, Provider } from '../../domain/auth';
export class SocialSignInDto {
  @ApiProperty({
    enum: [Provider.Google, Provider.Facebook],
    example: 'google',
  })
  @IsIn([Provider.Google, Provider.Facebook])
  provider!: Provider.Google | Provider.Facebook;
  @ApiProperty({
    minLength: 1,
    maxLength: 16384,
    writeOnly: true,
    description:
      'Google ID token or Facebook access token. Replace the placeholder with a real provider credential.',
    example: '<provider-token>',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16384)
  credential!: string;
}
export class PasswordSignInDto {
  @ApiProperty({
    minLength: 3,
    maxLength: 24,
    pattern: '^[a-zA-Z0-9_]+$',
    example: 'pilot_one',
  })
  @IsString()
  @Length(3, 24)
  @Matches(/^[a-zA-Z0-9_]+$/)
  username!: string;
  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    format: 'password',
    writeOnly: true,
    description:
      '12–128 characters; not trimmed. Use your own password instead of this documentation example.',
    example: 'example-only-passphrase',
  })
  @IsString()
  @Length(12, 128)
  password!: string;
}
export class SignUpDto extends PasswordSignInDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 40,
    example: 'Pilot One',
    description:
      'Visible pilot name, trimmed on registration; must contain a non-whitespace character and no control characters.',
  })
  @IsString()
  @Length(1, 40)
  @Matches(/\S/)
  // Reject control characters in a visible pilot name.
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\x00-\x1f\x7f]+$/)
  displayName!: string;
  @ApiPropertyOptional({
    enum: ['female', 'male', 'non_binary', 'unspecified'],
    default: 'unspecified',
  })
  @IsOptional()
  @IsEnum({
    female: 'female',
    male: 'male',
    non_binary: 'non_binary',
    unspecified: 'unspecified',
  })
  gender?: Gender;
}
export class PublicUserDto {
  @ApiProperty({
    format: 'uuid',
    example: '123e4567-e89b-42d3-a456-426614174000',
  })
  id!: string;
  @ApiProperty({ enum: Provider, example: Provider.Local }) provider!: Provider;
  @ApiProperty({ example: 'Pilot One' }) displayName!: string;
  @ApiProperty({ type: String, nullable: true, example: 'pilot_one' })
  username!: string | null;
  @ApiProperty({
    enum: ['female', 'male', 'non_binary', 'unspecified'],
    example: 'unspecified',
  })
  gender!: string;
  @ApiProperty({ type: String, nullable: true, format: 'email', example: null })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uri', example: null })
  avatarUrl!: string | null;
}
export class AuthResponseDto {
  @ApiProperty({
    description:
      'Deep Drill session JWT. Use it in the Authorization: Bearer header.',
    example: '<deep-drill-jwt>',
  })
  accessToken!: string;
  @ApiProperty({ format: 'date-time', example: '2026-10-30T12:00:00.000Z' })
  expiresAt!: string;
  @ApiProperty({ type: PublicUserDto }) user!: PublicUserDto;
}
export class SuccessDto {
  @ApiProperty({ example: true }) success!: boolean;
}
export class ErrorDto {
  @ApiProperty({ example: 401 }) statusCode!: number;
  @ApiProperty({ example: 'AUTH_INVALID_CREDENTIAL' }) code!: string;
  @ApiProperty({
    example: 'Could not authenticate with the supplied credentials.',
  })
  message!: string;
}
