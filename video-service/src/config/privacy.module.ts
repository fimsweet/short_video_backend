import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrivacyService } from './privacy.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
