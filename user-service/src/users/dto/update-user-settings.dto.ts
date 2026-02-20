export class UpdateUserSettingsDto {
  theme?: string;
  notificationsEnabled?: boolean;
  pushNotifications?: boolean;
  emailNotifications?: boolean;
  loginAlertsEnabled?: boolean; // Push notifications for new login events
  accountPrivacy?: string;
  requireFollowApproval?: boolean;
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

  // TikTok-style list privacy
  whoCanViewFollowingList?: string;
  whoCanViewFollowersList?: string;
  whoCanViewLikedVideos?: string;

  // Push notification preferences (granular)
  pushLikes?: boolean;
  pushComments?: boolean;
  pushNewFollowers?: boolean;
  pushMentions?: boolean;
  pushMessages?: boolean;
  pushProfileViews?: boolean;

  // In-app notification preferences (granular)
  inAppLikes?: boolean;
  inAppComments?: boolean;
  inAppNewFollowers?: boolean;
  inAppMentions?: boolean;
  inAppMessages?: boolean;
  inAppProfileViews?: boolean;
}
