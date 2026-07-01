import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { CreateAccountDto } from './create-account.dto';

export class ImportBulkDto {
  @IsIn(['json', 'csv'])
  format: 'json' | 'csv';

  @IsOptional()
  @IsArray()
  accounts?: CreateAccountDto[];

  @IsOptional()
  @IsString()
  csv?: string;
}
