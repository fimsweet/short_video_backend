export class UpdateUserSettingsDto {
  theme?: string;
  notificationsEnabled?: boolean;
  pushNotifications?: boolean;
  emailNotifications?: boolean;
  loginAlertsEnabled?: boolean; // Push notifications for new login events
  accountPrivacy?: string;
  showOnlineStatus?: boolean;
  autoplayVideos?: boolean;
  videoQuality?: string;
  language?: string;
  timezone?: string;

  // New privacy settings
  whoCanViewVideos?: string;
  whoCanSendMessages?: string;
  whoCanComment?: string;
  filterComments?: boolean;
}
