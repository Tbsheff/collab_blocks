/// <reference path="../../cypress.d.ts" />

describe('Comments Feature', () => {
    // Test users
    const user1 = {
        id: 'test-user-1',
        name: 'User 1'
    };

    const user2 = {
        id: 'test-user-2',
        name: 'User 2'
    };

    const commentText = 'This is a test comment';
    const replyText = 'This is a reply to the test comment';

    beforeEach(() => {
        // Reset any data and set up test conditions
        cy.intercept('GET', '**/api/comments/*', {
            statusCode: 200,
            body: []
        }).as('getComments');

        // Simulate successful comment creation
        cy.intercept('POST', '**/api/comments', (req: any) => {
            const comment = {
                id: `comment-${Date.now()}`,
                roomId: 'demo-room-1',
                blockId: req.body.blockId,
                bodyMd: req.body.bodyMd,
                userId: req.body.userId,
                parentId: req.body.parentId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                reactions: {}
            };

            req.reply({
                statusCode: 201,
                body: comment
            });
        }).as('createComment');

        // Simulate successful reaction
        cy.intercept('POST', '**/api/comments/*/reactions', (req: any) => {
            req.reply({
                statusCode: 200,
                body: {
                    commentId: req.url.split('/').reverse()[1],
                    emoji: req.body.emoji,
                    userId: req.body.userId
                }
            });
        }).as('addReaction');

        // Simulate successful reaction removal
        cy.intercept('DELETE', '**/api/comments/*/reactions/*', {
            statusCode: 200,
            body: {}
        }).as('removeReaction');

        // Simulate successful comment deletion
        cy.intercept('DELETE', '**/api/comments/*', {
            statusCode: 200,
            body: {}
        }).as('deleteComment');
    });

    it('As User 1, I can create a comment and see it displayed', () => {
        // Visit the app as User 1
        cy.visit('/?userId=' + user1.id + '&userName=' + user1.name);
        cy.wait('@getComments');

        // Open comments section
        cy.get('.comments-button').click();

        // Enter and submit a comment
        cy.get('.comment-form textarea').type(commentText);
        cy.get('.comment-form button').click();
        cy.wait('@createComment');

        // Verify comment appears in the list
        cy.get('.comments-list').contains(commentText);
    });

    it('As User 2, I can reply to User 1\'s comment', () => {
        // Set up: first create User 1's comment
        const user1Comment = {
            id: 'test-comment-1',
            roomId: 'demo-room-1',
            blockId: 'editor-block',
            bodyMd: commentText,
            userId: user1.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            reactions: {}
        };

        // Mock the comments API to return User 1's comment
        cy.intercept('GET', '**/api/comments/*', {
            statusCode: 200,
            body: [user1Comment]
        }).as('getCommentsWithUser1');

        // Visit as User 2
        cy.visit('/?userId=' + user2.id + '&userName=' + user2.name);
        cy.wait('@getCommentsWithUser1');

        // Open comments section
        cy.get('.comments-button').click();

        // Click reply on User 1's comment
        cy.contains(commentText).parent().find('button:contains("Reply")').click();

        // Enter and submit reply
        cy.get('.comment-form textarea').should('have.value', `@${user1.name} `);
        cy.get('.comment-form textarea').clear().type(replyText);
        cy.get('.comment-form button').click();
        cy.wait('@createComment');

        // Verify the reply appears in the UI
        cy.get('.comments-list').contains(replyText);
    });

    it('As User 1, I can add a reaction to User 2\'s reply', () => {
        // Set up: Create User 1's comment and User 2's reply
        const user1Comment = {
            id: 'test-comment-1',
            roomId: 'demo-room-1',
            blockId: 'editor-block',
            bodyMd: commentText,
            userId: user1.id,
            createdAt: new Date(Date.now() - 1000).toISOString(),
            updatedAt: new Date(Date.now() - 1000).toISOString(),
            reactions: {}
        };

        const user2Reply = {
            id: 'test-comment-2',
            roomId: 'demo-room-1',
            blockId: 'editor-block',
            bodyMd: replyText,
            userId: user2.id,
            parentId: 'test-comment-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            reactions: {}
        };

        // Mock the comments API to return both comments
        cy.intercept('GET', '**/api/comments/*', {
            statusCode: 200,
            body: [user1Comment, user2Reply]
        }).as('getBothComments');

        // Visit as User 1
        cy.visit('/?userId=' + user1.id + '&userName=' + user1.name);
        cy.wait('@getBothComments');

        // Open comments section
        cy.get('.comments-button').click();

        // Find User 2's reply and add a reaction
        cy.contains(replyText).parent().find('button:contains("👍")').click();
        cy.wait('@addReaction');

        // Verify the reaction appears (button should change style)
        cy.contains(replyText).parent().find('.reaction-btn').should('have.class', 'bg-blue-100');
    });

    it('As User 1, I can delete my own comment', () => {
        // Set up: Create User 1's comment
        const user1Comment = {
            id: 'test-comment-1',
            roomId: 'demo-room-1',
            blockId: 'editor-block',
            bodyMd: commentText,
            userId: user1.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            reactions: {}
        };

        // Mock the comments API to return User 1's comment
        cy.intercept('GET', '**/api/comments/*', {
            statusCode: 200,
            body: [user1Comment]
        }).as('getUser1Comment');

        // Visit as User 1
        cy.visit('/?userId=' + user1.id + '&userName=' + user1.name);
        cy.wait('@getUser1Comment');

        // Open comments section
        cy.get('.comments-button').click();

        // Find and click delete button
        cy.contains(commentText).parent().find('button:contains("Delete")').click();
        cy.wait('@deleteComment');

        // Mock API to return empty comments after deletion
        cy.intercept('GET', '**/api/comments/*', {
            statusCode: 200,
            body: []
        }).as('getEmptyComments');

        // Verify the comment no longer appears
        cy.contains(commentText).should('not.exist');
        cy.get('.empty-state').should('exist');
    });

    // New test: Full end-to-end scenario with two users interacting
    it('Two users can have a complete conversation with comments, replies, and reactions', () => {
        // Initialize with empty comments
        let commentsDatabase: any[] = [];

        // Set up dynamic API mocks to simulate server behavior 
        cy.intercept('GET', '**/api/comments/*', (req: any) => {
            req.reply({
                statusCode: 200,
                body: commentsDatabase
            });
        }).as('getComments');

        cy.intercept('POST', '**/api/comments', (req: any) => {
            const newComment = {
                id: `comment-${Date.now()}`,
                roomId: 'demo-room-1',
                blockId: req.body.blockId,
                bodyMd: req.body.bodyMd,
                userId: req.body.userId,
                parentId: req.body.parentId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                reactions: {}
            };

            // Add to our database
            commentsDatabase.push(newComment);

            req.reply({
                statusCode: 201,
                body: newComment
            });
        }).as('createComment');

        cy.intercept('POST', '**/api/comments/*/reactions', (req: any) => {
            const commentId = req.url.split('/').reverse()[1];
            const emoji = req.body.emoji;
            const userId = req.body.userId;

            // Update reactions in our database
            commentsDatabase = commentsDatabase.map(comment => {
                if (comment.id === commentId) {
                    if (!comment.reactions[emoji]) {
                        comment.reactions[emoji] = [];
                    }
                    comment.reactions[emoji].push(userId);
                }
                return comment;
            });

            req.reply({
                statusCode: 200,
                body: {
                    commentId,
                    emoji,
                    userId
                }
            });
        }).as('addReaction');

        cy.intercept('DELETE', '**/api/comments/*', (req: any) => {
            const commentId = req.url.split('/').reverse()[0];

            // Remove comment from our database
            commentsDatabase = commentsDatabase.filter(comment => comment.id !== commentId);

            req.reply({
                statusCode: 200,
                body: {}
            });
        }).as('deleteComment');

        // STEP 1: User 1 creates a comment
        cy.visit('/?userId=' + user1.id + '&userName=' + user1.name);
        cy.wait('@getComments');
        cy.get('.comments-button').click();

        const user1InitialComment = "Hello, I have a question about this!";
        cy.get('.comment-form textarea').type(user1InitialComment);
        cy.get('.comment-form button').click();
        cy.wait('@createComment');

        // Verify comment appears
        cy.get('.comments-list').contains(user1InitialComment);

        // STEP 2: User 2 replies to User 1's comment
        // Simulate browser change by visiting with User 2's info
        cy.visit('/?userId=' + user2.id + '&userName=' + user2.name);
        cy.wait('@getComments');
        cy.get('.comments-button').click();

        // Verify User 1's comment is visible
        cy.get('.comments-list').contains(user1InitialComment);

        // Reply to User 1's comment
        cy.contains(user1InitialComment).parent().find('button:contains("Reply")').click();
        const user2Reply = "Great question! Here's what I think...";
        cy.get('.comment-form textarea').clear().type(user2Reply);
        cy.get('.comment-form button').click();
        cy.wait('@createComment');

        // Verify reply appears
        cy.get('.comments-list').contains(user2Reply);

        // STEP 3: User 1 adds a reaction to User 2's reply
        cy.visit('/?userId=' + user1.id + '&userName=' + user1.name);
        cy.wait('@getComments');
        cy.get('.comments-button').click();

        // Verify both comments are visible
        cy.get('.comments-list').contains(user1InitialComment);
        cy.get('.comments-list').contains(user2Reply);

        // Add reaction to User 2's reply
        cy.contains(user2Reply).parent().find('button:contains("👍")').click();
        cy.wait('@addReaction');

        // Verify reaction appears
        cy.contains(user2Reply).parent().find('.reaction-btn:contains("👍")').should('have.class', 'bg-blue-100');

        // STEP 4: User 2 sees the reaction and adds another comment
        cy.visit('/?userId=' + user2.id + '&userName=' + user2.name);
        cy.wait('@getComments');
        cy.get('.comments-button').click();

        // Verify reaction is visible
        cy.contains(user2Reply).parent().find('.reaction-btn:contains("👍")').should('have.class', 'bg-blue-100');

        // Add a follow-up comment
        const user2FollowUp = "I'm glad you found that helpful!";
        cy.get('.comment-form textarea').type(user2FollowUp);
        cy.get('.comment-form button').click();
        cy.wait('@createComment');

        // Verify follow-up appears
        cy.get('.comments-list').contains(user2FollowUp);

        // STEP 5: User 1 returns and deletes their original comment
        cy.visit('/?userId=' + user1.id + '&userName=' + user1.name);
        cy.wait('@getComments');
        cy.get('.comments-button').click();

        // Delete own comment
        cy.contains(user1InitialComment).parent().find('button:contains("Delete")').click();
        cy.wait('@deleteComment');

        // Verify comment is deleted
        cy.contains(user1InitialComment).should('not.exist');
    });
}); 