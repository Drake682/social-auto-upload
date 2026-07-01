import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import { ImportBulkDto } from './dto/import-bulk.dto';
import { UpdateAccountStatusDto } from './dto/update-account-status.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  /**
   * POST /accounts — Create a new social media account.
   * session_data is encrypted before DB write and NEVER echoed back.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: any, @Body() createDto: CreateAccountDto) {
    const result = await this.accountsService.create(user.sub, user.tenantId, createDto);
    return { code: 201, data: result, msg: 'Account created' };
  }

  /**
   * GET /accounts — List all accounts for the authenticated user.
   * Session data is fully excluded from response.
   */
  @Get()
  async findAll(@CurrentUser() user: any, @Query() query: ListAccountsQueryDto) {
    const result = await this.accountsService.findAll(user.sub, user.tenantId, query);
    return { code: 200, data: result, msg: 'Accounts retrieved' };
  }

  /**
   * POST /accounts/import-bulk — Import social accounts from JSON array or CSV.
   * Plain session data is accepted only in request body and encrypted before DB write.
   */
  @Post('import-bulk')
  @HttpCode(HttpStatus.OK)
  async importBulk(@CurrentUser() user: any, @Body() importDto: ImportBulkDto) {
    const result = await this.accountsService.importBulk(user.sub, user.tenantId, importDto);
    return { code: 200, data: result, msg: 'Bulk import processed' };
  }

  /**
   * GET /accounts/:id/health — Real uploader-backed health ping.
   * Session data is decrypted only inside service and never returned.
   */
  @Get(':id/health')
  async health(@CurrentUser() user: any, @Param('id') id: string) {
    const result = await this.accountsService.checkHealth(user.sub, user.tenantId, parseInt(id));
    return { code: 200, data: result, msg: 'Account health checked' };
  }

  /**
   * GET /accounts/:id — Get a single account.
   * Ownership verified — user can only access their own accounts.
   */
  @Get(':id')
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    const result = await this.accountsService.findOne(user.sub, user.tenantId, parseInt(id));
    return { code: 200, data: result, msg: 'Account retrieved' };
  }

  /**
   * PATCH /accounts/:id — Update account name or platform.
   */
  @Patch(':id')
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() updateDto: UpdateAccountDto,
  ) {
    const result = await this.accountsService.update(user.sub, user.tenantId, parseInt(id), updateDto);
    return { code: 200, data: result, msg: 'Account updated' };
  }

  /**
   * PATCH /accounts/:id/status — Update account health status.
   */
  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() statusDto: UpdateAccountStatusDto,
  ) {
    const result = await this.accountsService.updateStatus(user.sub, user.tenantId, parseInt(id), statusDto.status);
    return { code: 200, data: result, msg: 'Status updated' };
  }

  /**
   * DELETE /accounts/:id — Delete an account.
   * Ownership verified.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentUser() user: any, @Param('id') id: string) {
    const result = await this.accountsService.remove(user.sub, user.tenantId, parseInt(id));
    return { code: 200, data: result, msg: 'Account deleted' };
  }
}
