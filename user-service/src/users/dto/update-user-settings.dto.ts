export class UpdateUserSettingsDto {
  theme?: string;
  notificationsEnabled?: boolean;
  pushNotifications?: boolean;
  emailNotifications?: boolean;
  accountPrivacy?: string;
  showOnlineStatus?: boolean;
  autoplayVideos?: boolean;
  videoQuality?: string;
  language?: string;
  timezone?: string;
}
