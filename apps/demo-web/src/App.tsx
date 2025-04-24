import { useEffect, useRef, useState } from 'react';
import { createClient, ConnectionProvider, useCursor, createStorageHooks, CommentsProvider, CommentsThread, Connection } from '@collabblocks/react-sdk';

// For MVP, we'll use a simple local URL and room ID
const WS_URL = 'ws://localhost:8080';
const ROOM_ID = 'demo-room-1';
const TOKEN = 'dev-token';

// Random user ID for this session
const USER_ID = `user_${Math.floor(Math.random() * 10000)}`;
const USER_NAME = `User ${Math.floor(Math.random() * 10000)}`;

// Enable live storage
const { useLiveObject } = createStorageHooks();

function App() {
    const [connection, setConnection] = useState<Connection | null>(null);

    // Initialize connection
    useEffect(() => {
        const client = createClient(WS_URL, ROOM_ID, TOKEN);
        setConnection(client);

        return () => {
            client?.disconnect();
        };
    }, []);

    if (!connection) {
        return <div>Connecting...</div>;
    }

    return (
        <ConnectionProvider value={connection}>
            <CommentsProvider userId={USER_ID}>
                <div className="container mx-auto p-4">
                    <h1 className="text-2xl font-bold mb-4">CollabBlocks Demo</h1>
                    <div className="mb-4 bg-gray-100 p-2 rounded">
                        <div>You are: {USER_ID}</div>
                    </div>
                    <Editor />
                </div>
            </CommentsProvider>
        </ConnectionProvider>
    );
}

function Editor() {
    const { otherCursors, setCursor } = useCursor();
    const [doc, updateDoc] = useLiveObject({ text: 'Type something here...' });
    const containerRef = useRef<HTMLDivElement>(null);
    const [showComments, setShowComments] = useState(false);

    // Handle mouse movement
    const handleMouseMove = (e: React.MouseEvent) => {
        if (!containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        setCursor(x, y);
    };

    // Handle text change
    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        updateDoc({ text: e.target.value });
    };

    return (
        <div className="flex flex-col md:flex-row gap-4">
            <div
                className="editor-container flex-1 relative border rounded-lg p-4"
                ref={containerRef}
                onMouseMove={handleMouseMove}
            >
                {/* Other users' cursors */}
                {otherCursors.map((user) => (
                    user.cursor && (
                        <div
                            key={user.userId}
                            className="cursor absolute w-3 h-3 rounded-full transform -translate-x-1/2 -translate-y-1/2 z-10"
                            data-name={user.userId}
                            style={{
                                left: `${user.cursor.x * 100}%`,
                                top: `${user.cursor.y * 100}%`,
                                backgroundColor: stringToColor(user.userId),
                            }}
                        />
                    )
                ))}

                {/* Text editor */}
                <textarea
                    className="w-full h-64 p-2 border rounded"
                    value={doc.text}
                    onChange={handleTextChange}
                    placeholder="Start typing..."
                />

                <div className="mt-4">
                    <button
                        className="comments-button px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        onClick={() => setShowComments(!showComments)}
                    >
                        {showComments ? 'Hide Comments' : 'Show Comments'}
                    </button>
                </div>
            </div>

            {/* Comments section */}
            {showComments && (
                <div className="comments-section w-full md:w-96">
                    <CommentsThread
                        blockId="editor-block"
                        userId={USER_ID}
                        userName={USER_NAME}
                        maxHeight="500px"
                    />
                </div>
            )}
        </div>
    );
}

// Helper to generate a color from a string
function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    const hue = hash % 360;
    return `hsl(${hue}, 70%, 50%)`;
}

export default App; 