import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface PrivacyCheckResult {
  allowed: boolean;
  reason?: string;
}

interface PrivacySettings {
  accountPrivacy: string;
  whoCanViewVideos: string;
  whoCanSendMessages: string;
  whoCanComment: string;
  filterComments: boolean;
}

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);
  private readonly userServiceUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.userServiceUrl = this.configService.get<string>(
      'USER_SERVICE_URL',
      'http://localhost:3000',
    );
  }

  /**
   * Check if requester can perform action on target user's content
   */
  async checkPermission(
    requesterId: string,
    targetUserId: string,
    action: 'view_video' | 'send_message' | 'comment',
  ): Promise<PrivacyCheckResult & { isDeactivated?: boolean }> {
    // Same user always allowed
    if (requesterId === targetUserId) {
      return { allowed: true };
    }

    try {
      const response = await fetch(`${this.userServiceUrl}/users/privacy/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterId,
          targetUserId,
          action,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Privacy check failed: ${response.status}`);
        return { allowed: true }; // Default to allowed on error
      }

      const result = await response.json();
      return {
        allowed: result.allowed ?? true,
        reason: result.reason,
        isDeactivated: result.isDeactivated,
      };
    } catch (error) {
      this.logger.error('Error checking privacy permission:', error);
      return { allowed: true }; // Default to allowed on error
    }
  }

  /**
   * Get privacy settings for a user
   */
  async getPrivacySettings(userId: string): Promise<PrivacySettings> {
    try {
      const response = await fetch(
        `${this.userServiceUrl}/users/privacy/${userId}`,
      );

      if (!response.ok) {
        this.logger.warn(`Failed to get privacy settings: ${response.status}`);
        return this.getDefaultSettings();
      }

      const result = await response.json();
      return result.settings ?? this.getDefaultSettings();
    } catch (error) {
      this.logger.error('Error getting privacy settings:', error);
      return this.getDefaultSettings();
    }
  }

  /**
   * Get privacy settings for multiple users (batch) - efficient for feed filtering
   */
  async getPrivacySettingsBatch(userIds: string[]): Promise<Map<string, PrivacySettings>> {
    const result = new Map<string, PrivacySettings>();
    if (!userIds || userIds.length === 0) return result;

    const uniqueIds = [...new Set(userIds)];
    
    try {
      const response = await fetch(`${this.userServiceUrl}/users/privacy/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: uniqueIds.map(id => parseInt(id, 10)) }),
      });

      if (!response.ok) {
        this.logger.warn(`Batch privacy settings fetch failed: ${response.status}`);
        // Default all to public on error
        for (const id of uniqueIds) {
          result.set(id, this.getDefaultSettings());
        }
        return result;
      }

      const data = await response.json();
      const settings = data.settings || {};
      
      for (const id of uniqueIds) {
        if (settings[id]) {
          result.set(id, settings[id]);
        } else {
          result.set(id, this.getDefaultSettings());
        }
      }
      
      return result;
    } catch (error) {
      this.logger.error('Error fetching batch privacy settings:', error);
      for (const id of uniqueIds) {
        result.set(id, this.getDefaultSettings());
      }
      return result;
    }
  }

  /**
   * Get deactivated user IDs from a batch (calls user-service)
   */
  async getDeactivatedUserIds(userIds: string[]): Promise<Set<string>> {
    if (!userIds || userIds.length === 0) return new Set();

    try {
      const response = await fetch(`${this.userServiceUrl}/users/deactivated-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: userIds.map(id => parseInt(id, 10)) }),
      });

      if (!response.ok) {
        this.logger.warn(`Deactivated batch check failed: ${response.status}`);
        return new Set();
      }

      const data = await response.json();
      return new Set((data.deactivatedIds || []).map((id: number) => id.toString()));
    } catch (error) {
      this.logger.error('Error checking deactivated users:', error);
      return new Set();
    }
  }

  /**
   * Filter videos based on owner privacy settings for public feeds
   * Removes videos from users with restrictive privacy settings or deactivated accounts
   */
  async filterVideosByPrivacy(videos: any[], viewerId?: string): Promise<any[]> {
    if (!videos || videos.length === 0) return videos;

    // Get unique owner IDs
    const ownerIds = [...new Set(videos.map(v => v.userId?.toString()))].filter(Boolean);
    if (ownerIds.length === 0) return videos;

    // Batch fetch privacy settings AND deactivation status in parallel
    const [settingsMap, deactivatedIds] = await Promise.all([
      this.getPrivacySettingsBatch(ownerIds),
      this.getDeactivatedUserIds(ownerIds),
    ]);

    return videos.filter(video => {
      const ownerId = video.userId?.toString();
      if (!ownerId) return true;
      
      // Owner's own videos always visible
      if (viewerId && ownerId === viewerId) return true;

      // Filter out deactivated users' videos
      if (deactivatedIds.has(ownerId)) return false;

      const settings = settingsMap.get(ownerId);
      if (!settings) return true;

      // Private account: videos shouldn't appear in public feeds
      if (settings.accountPrivacy === 'private') return false;

      // whoCanViewVideos check
      if (settings.whoCanViewVideos === 'onlyMe') return false;
      if (settings.whoCanViewVideos === 'friends') return false; // Can't determine friendship in batch for public feeds

      return true;
    });
  }

  /**
   * Check if requester can view videos of target user
   */
  async canViewVideo(requesterId: string, videoOwnerId: string): Promise<PrivacyCheckResult> {
    return this.checkPermission(requesterId, videoOwnerId, 'view_video');
  }

  /**
   * Check if requester can send message to target user
   */
  async canSendMessage(requesterId: string, recipientId: string): Promise<PrivacyCheckResult & { isDeactivated?: boolean }> {
    return this.checkPermission(requesterId, recipientId, 'send_message');
  }

  /**
   * Check if requester can comment on target user's video
   */
  async canComment(requesterId: string, videoOwnerId: string): Promise<PrivacyCheckResult & { isDeactivated?: boolean }> {
    return this.checkPermission(requesterId, videoOwnerId, 'comment');
  }

  /**
   * Check if comment content is toxic using Gemini AI
   * Returns true if the content contains profanity, insults, or toxic language
   */
  async checkToxicityWithAI(content: string): Promise<boolean> {
    // Skip very short or empty content
    if (!content || content.trim().length < 2) return false;

    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY not configured, falling back to word list');
      return this.containsBadWords(content);
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `You are a content moderation classifier. Analyze the following comment and determine if it contains toxic content.

Toxic content includes: profanity, vulgar language, slurs, insults, hate speech, sexual content, threats, or extremely negative/abusive language in ANY language (Vietnamese, English, or others).

Do NOT flag: normal criticism, mild negativity, sarcasm, slang that is not vulgar, or casual language.

Comment: "${content}"

Respond with ONLY one word: "TOXIC" or "SAFE". Nothing else.`,
              }],
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 10,
            },
          }),
        },
      );

      if (!response.ok) {
        this.logger.warn(`Gemini toxicity check failed: ${response.status}`);
        return this.containsBadWords(content);
      }

      const data = await response.json();
      const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.toUpperCase();
      return result === 'TOXIC';
    } catch (error) {
      this.logger.error('Gemini toxicity check error:', error);
      return this.containsBadWords(content);
    }
  }

  /**
   * Simple bad words check (fallback when AI is unavailable)
   */
  private containsBadWords(content: string): boolean {
    const lowerContent = content.toLowerCase();
    return this.getBadWordsList().some(word => lowerContent.includes(word));
  }

  /**
   * Censor bad words in content by replacing them with ***
   */
  censorBadWords(content: string): string {
    if (!content) return content;
    const badWords = this.getBadWordsList();
    let censored = content;
    for (const word of badWords) {
      const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      censored = censored.replace(regex, '***');
    }
    return censored;
  }

  /**
   * Get the list of bad words for filtering
   */
  private getBadWordsList(): string[] {
    return [
      'đm', 'dcm', 'dm', 'đéo', 'địt', 'lồn', 'cặc', 'buồi', 'cc', 'cl', 'đĩ',
      'đụ', 'vkl', 'vãi', 'khốn', 'súc vật', 'con mẹ',
      'fuck', 'shit', 'bitch', 'dick', 'pussy', 'bastard', 'retard',
    ];
  }

  /**
   * Check if comment should be filtered (contains bad words)
   */
  async shouldFilterComment(videoOwnerId: string, content: string): Promise<boolean> {
    const settings = await this.getPrivacySettings(videoOwnerId);
    
    if (!settings.filterComments) {
      return false;
    }

    return this.containsBadWords(content);
  }

  private getDefaultSettings(): PrivacySettings {
    return {
      accountPrivacy: 'public',
      whoCanViewVideos: 'everyone',
      whoCanSendMessages: 'everyone',
      whoCanComment: 'everyone',
      filterComments: true,
    };
  }
}
