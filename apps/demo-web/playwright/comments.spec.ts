import { test, expect, Page } from '@playwright/test';

test.describe('Two-user commenting scenario', () => {
    let user1Page: Page;
    let user2Page: Page;
    const commentText = 'This is a test comment from User 1';
    const replyText = 'This is a reply from User 2';

    test.beforeAll(async ({ browser }) => {
        // Create two browser contexts for two users
        const user1Context = await browser.newContext();
        const user2Context = await browser.newContext();

        // Create pages for each user
        user1Page = await user1Context.newPage();
        user2Page = await user2Context.newPage();

        // Navigate to the application with different user IDs
        await user1Page.goto('/?userId=user1&userName=User1');
        await user2Page.goto('/?userId=user2&userName=User2');

        // Wait for both pages to be fully loaded
        await user1Page.waitForSelector('.editor-container');
        await user2Page.waitForSelector('.editor-container');
    });

    test.afterAll(async () => {
        await user1Page.close();
        await user2Page.close();
    });

    test('User 1 can create a comment and User 2 can reply to it', async () => {
        // Step 1: User 1 opens the comments section
        await user1Page.click('.comments-button');
        await user1Page.waitForSelector('.comments-thread');

        // Step 2: User 1 creates a comment
        await user1Page.fill('.comment-form textarea', commentText);
        await user1Page.click('.comment-form button');

        // Step 3: Verify the comment appears for User 1
        await expect(user1Page.locator('.comments-list')).toContainText(commentText);

        // Step 4: User 2 opens the comments section
        await user2Page.click('.comments-button');
        await user2Page.waitForSelector('.comments-thread');

        // Step 5: Wait for User 1's comment to appear for User 2
        await expect(user2Page.locator('.comments-list')).toContainText(commentText, { timeout: 5000 });

        // Step 6: User 2 replies to User 1's comment
        await user2Page.click('button:has-text("Reply")');
        await user2Page.fill('.comment-form textarea', replyText);
        await user2Page.click('.comment-form button');

        // Step 7: Verify the reply appears for User 2
        await expect(user2Page.locator('.comments-list')).toContainText(replyText);

        // Step 8: Verify the reply appears for User 1
        await expect(user1Page.locator('.comments-list')).toContainText(replyText, { timeout: 5000 });
    });

    test('Users can add and remove reactions to comments', async () => {
        // Step 1: User 2 adds a reaction to User 1's comment
        const thumbsUpButton = user2Page.locator('.comment-item', { hasText: commentText }).locator('button:has-text("👍")');
        await thumbsUpButton.click();

        // Step 2: Verify the reaction appears for User 2
        await expect(thumbsUpButton).toHaveClass(/bg-blue-100/);

        // Step 3: Verify the reaction also appears for User 1
        await expect(user1Page.locator('.comment-item', { hasText: commentText }).locator('button:has-text("👍")')).toHaveClass(/bg-blue-100/, { timeout: 5000 });

        // Step 4: User 1 adds a different reaction to User 2's reply
        const heartButton = user1Page.locator('.comment-item', { hasText: replyText }).locator('button:has-text("❤️")');
        await heartButton.click();

        // Step 5: Verify the reaction appears for User 1
        await expect(heartButton).toHaveClass(/bg-blue-100/);

        // Step 6: Verify the reaction also appears for User 2
        await expect(user2Page.locator('.comment-item', { hasText: replyText }).locator('button:has-text("❤️")')).toHaveClass(/bg-blue-100/, { timeout: 5000 });

        // Step 7: User 2 removes their reaction to User 1's comment
        await thumbsUpButton.click();

        // Step 8: Verify the reaction is removed for User 2
        await expect(thumbsUpButton).not.toHaveClass(/bg-blue-100/);

        // Step 9: Verify the reaction is also removed for User 1
        await expect(user1Page.locator('.comment-item', { hasText: commentText }).locator('button:has-text("👍")')).not.toHaveClass(/bg-blue-100/, { timeout: 5000 });
    });

    test('User can delete their own comment', async () => {
        // Step 1: User 1 deletes their comment
        await user1Page.locator('.comment-item', { hasText: commentText }).locator('button:has-text("Delete")').click();

        // Step 2: Verify the comment is removed for User 1
        await expect(user1Page.locator('.comments-list')).not.toContainText(commentText, { timeout: 5000 });

        // Step 3: Verify the comment is also removed for User 2
        await expect(user2Page.locator('.comments-list')).not.toContainText(commentText, { timeout: 5000 });

        // Step 4: Verify the reply is also removed (cascading delete)
        await expect(user1Page.locator('.comments-list')).not.toContainText(replyText, { timeout: 5000 });
        await expect(user2Page.locator('.comments-list')).not.toContainText(replyText, { timeout: 5000 });
    });
}); 