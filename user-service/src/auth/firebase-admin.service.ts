import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class FirebaseAdminService {
    private firebaseApp: admin.app.App;

    constructor(private configService: ConfigService) {
        // Initialize Firebase Admin only if not already initialized
        if (admin.apps.length === 0) {
            const serviceAccountPath = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');

            if (serviceAccountPath) {
                // Resolve absolute path from project root
                const absolutePath = path.resolve(process.cwd(), serviceAccountPath);
                console.log(`Looking for Firebase service account at: ${absolutePath}`);

                if (fs.existsSync(absolutePath)) {
                    // Read and parse the JSON file
                    const serviceAccount = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
                    this.firebaseApp = admin.initializeApp({
                        credential: admin.credential.cert(serviceAccount),
                    });
                    console.log('Firebase Admin initialized with service account');
                } else {
                    console.warn(`Firebase service account file not found at: ${absolutePath}`);
                }
            } else {
                // Initialize with environment variables
                const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
                const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
                const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

                if (projectId && clientEmail && privateKey) {
                    this.firebaseApp = admin.initializeApp({
                        credential: admin.credential.cert({
                            projectId,
                            clientEmail,
                            privateKey,
                        }),
                    });
                    console.log('Firebase Admin initialized with environment variables');
                } else {
                    console.warn('Firebase Admin not configured - phone auth will not work');
                }
            }
        } else {
            this.firebaseApp = admin.apps[0]!;
        }
    }

    // Verify Firebase ID Token and extract phone number
    async verifyPhoneToken(idToken: string): Promise<{ uid: string; phone: string }> {
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);

            if (!decodedToken.phone_number) {
                throw new UnauthorizedException('Token does not contain phone number');
            }

            return {
                uid: decodedToken.uid,
                phone: decodedToken.phone_number,
            };
        } catch (error) {
            console.error('Firebase token verification failed:', error);
            throw new UnauthorizedException('Invalid Firebase token');
        }
    }

    // Get Firebase Auth instance
    getAuth(): admin.auth.Auth {
        return admin.auth();
    }
}
