import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
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
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 429, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly signIn: SignInUseCase,
    private readonly register: RegisterUseCase,
    private readonly signOut: SignOutUseCase,
  ) {}
  @Post('sign-in')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthResponseDto })
  social(@Body() input: SocialSignInDto) {
    return this.signIn.social(input.provider, input.credential);
  }
  @Post('sign-in/password')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthResponseDto })
  password(@Body() input: PasswordSignInDto) {
    return this.signIn.local(input.username, input.password);
  }
  @Post('sign-up')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiResponse({ status: 409, type: ErrorDto })
  signUp(@Body() input: SignUpDto) {
    return this.register.execute(input);
  }
  @Post('sign-out')
  @HttpCode(200)
  @UseGuards(ActiveSessionGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: SuccessDto })
  logout(@Req() request: AuthenticatedRequest) {
    return this.signOut.execute(request.auth);
  }
}
