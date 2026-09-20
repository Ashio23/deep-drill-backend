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
  @ApiProperty({ enum: [Provider.Google, Provider.Facebook] })
  @IsIn([Provider.Google, Provider.Facebook])
  provider!: Provider.Google | Provider.Facebook;
  @ApiProperty({ maxLength: 16384 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16384)
  credential!: string;
}
export class PasswordSignInDto {
  @ApiProperty({ minLength: 3, maxLength: 24, pattern: '^[a-zA-Z0-9_]+$' })
  @IsString()
  @Length(3, 24)
  @Matches(/^[a-zA-Z0-9_]+$/)
  username!: string;
  @ApiProperty({ minLength: 12, maxLength: 128, format: 'password' })
  @IsString()
  @Length(12, 128)
  password!: string;
}
export class SignUpDto extends PasswordSignInDto {
  @ApiProperty({ minLength: 1, maxLength: 40 })
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
  @ApiProperty() id!: string;
  @ApiProperty({ enum: Provider }) provider!: Provider;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) username!: string | null;
  @ApiProperty() gender!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
}
export class AuthResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
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
