import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  RegisterUseCase,
  SignInUseCase,
  SignOutUseCase,
} from '../../application/auth.use-cases';
import { ActiveSessionGuard, AuthenticatedRequest } from './session.guard';
import {
  AuthResponseDto,
  ErrorDto,
  PasswordSignInDto,
  SignUpDto,
  SocialSignInDto,
  SuccessDto,
} from './auth.dto';
@ApiTags('Authentication')
@ApiResponse({
  status: 400,
  description: 'Invalid fields or unsupported provider.',
  type: ErrorDto,
})
@ApiResponse({
  status: 401,
  description: 'Invalid or expired credentials; invalid or revoked session.',
  type: ErrorDto,
})
@ApiResponse({
  status: 429,
  description: 'Per-IP request limit exceeded.',
  type: ErrorDto,
})
@ApiResponse({
  status: 503,
  description: 'Provider disabled or account storage temporarily unavailable.',
  type: ErrorDto,
})
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(
    private readonly signIn: SignInUseCase,
    private readonly register: RegisterUseCase,
    private readonly signOut: SignOutUseCase,
  ) {}
  @Post('sign-in')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in with Google or Facebook',
    description:
      'Validates the provider credential and creates a Deep Drill session. A first sign-in creates the user. Emails do not automatically link accounts.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  async social(@Body() input: SocialSignInDto) {
    const response = await this.signIn.social(input.provider, input.credential);
    if (input.provider === 'google')
      this.logger.log(
        `Google authentication successful userId=${response.user.id}`,
      );
    return response;
  }
  @Post('sign-in/password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in with username and password',
    description:
      'Usernames are case-insensitive. An unknown user and an incorrect password return the same error.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  password(@Body() input: PasswordSignInDto) {
    return this.signIn.local(input.username, input.password);
  }
  @Post('sign-up')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Register a local account',
    description:
      'Creates an account and returns its first session. Unknown fields are rejected. Passwords are never returned.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Account could not be created; try another username.',
    type: ErrorDto,
  })
  signUp(@Body() input: SignUpDto) {
    return this.register.execute(input);
  }
  @Post('sign-out')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign out the current session',
    description:
      'Requires an active Deep Drill bearer token. Revokes only that session; using the token again returns HTTP 401. No request body is required.',
  })
  @UseGuards(ActiveSessionGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: SuccessDto })
  logout(@Req() request: AuthenticatedRequest) {
    return this.signOut.execute(request.auth);
  }
}
