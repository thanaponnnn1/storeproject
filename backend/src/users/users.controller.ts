import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'ข้อมูลผู้ใช้ที่ login อยู่' })
  me(@CurrentUser() user: AccessTokenPayload) {
    return this.usersService.findById(user.sub);
  }

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'รายชื่อผู้ใช้ทั้งหมด (ADMIN เท่านั้น)' })
  findAll() {
    return this.usersService.findAll();
  }
}
