import React, { useState, useEffect, createContext, useContext, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, addDoc, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Label } from 'recharts';

// Create a context for Firebase and User
const AppContext = createContext(null);

// --- Helper functions for formatting ---
const formatTimestamp = (isoString) => {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleString(); // Formats to local date and time
};

const formatSymptoms = (symptoms) => {
    if (!symptoms) return 'N/A';
    const activeSymptoms = Object.keys(symptoms)
        .filter(key => symptoms[key].checked)
        .map(key => {
            const severity = symptoms[key].severity;
            return `${key.replace(/([A-Z])/g, ' $1').trim()} (Severity: ${severity}/10)`;
        });
    return activeSymptoms.join(', ') || 'N/A';
};

const formatFood = (foodEntries) => {
    if (!foodEntries || foodEntries.length === 0) return 'N/A';
    return foodEntries.map(foodEntry => {
        let foodString = foodEntry.name;
        if (foodEntry.quantity && foodEntry.measurement) {
            foodString += ` (${foodEntry.quantity} ${foodEntry.measurement})`;
        }
        return foodString;
    }).join('; ');
};

const formatCurrentMedication = (med) => {
    const dosage = med.dosageAmount && med.dosageUnit ? `${med.dosageAmount}${med.dosageUnit}` : 'N/A';
    const times = med.medTimes && med.medTimes.length > 0 ? ` at ${med.medTimes.join(', ')}` : '';
    return `${med.name} (${dosage}, ${med.frequency}${times})`;
};

// Bristol Stool Chart descriptions for tooltips
const fullBristolDescriptions = {
    'Type 1': 'Separate hard lumps, like nuts (hard to pass)', 'Type 2': 'Sausage-shaped, but lumpy', 'Type 3': 'Like a sausage but with cracks on its surface',
    'Type 4': 'Like a sausage or snake, smooth and soft', 'Type 5': 'Soft blobs with clear-cut edges (passed easily)', 'Type 6': 'Fluffy pieces with ragged edges, a mushy stool',
    'Type 7': 'Entirely liquid, watery',
};
// Updated Bristol colors for a better green-to-red gradient, Type 4 is ideal (green)
const bristolColors = {
    'Type 1': '#B71C1C', // Dark Red (Very undesirable)
    'Type 2': '#D32F2F', // Red
    'Type 3': '#FBC02D', // Yellow-Orange
    'Type 4': '#4CAF50', // Green (Ideal)
    'Type 5': '#FFEB3B', // Yellow
    'Type 6': '#FF9800', // Orange
    'Type 7': '#7B1FA2', // Dark Purple (Very undesirable) - distinct from reds for liquid
};
const symptomColors = { bloating: '#82ca9d', cramps: '#8884d8', urgency: '#ffc658', fatigue: '#ff7300', nausea: '#00C49F', jointPain: '#FFBB28', stomachPain: '#a4de6c', headaches: '#d0ed57' };


const App = () => {
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [firebaseApp, setFirebaseApp] = useState(null);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [logEntries, setLogEntries] = useState([]);
    const [mainIbdMed, setMainIbdMed] = useState(null);
    const [supplements, setSupplements] = useState([]);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // Initialize Firebase and set up auth listener
    useEffect(() => {
        try {
            const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
            const app = initializeApp(firebaseConfig);
            setFirebaseApp(app);
            const firestoreDb = getFirestore(app);
            setDb(firestoreDb);
            const firebaseAuth = getAuth(app);
            setAuth(firebaseAuth);

            const initialAuth = async () => {
                try {
                    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
                    if (initialAuthToken) {
                        await signInWithCustomToken(firebaseAuth, initialAuthToken);
                    } else {
                        await signInAnonymously(firebaseAuth);
                    }
                } catch (error) {
                    console.error("Firebase authentication error:", error);
                }
            };
            initialAuth();

            const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
                if (user) {
                    setUserId(user.uid);
                    setIsAuthReady(true);
                } else {
                    setUserId(null);
                    setIsAuthReady(true);
                }
            });

            return () => unsubscribeAuth();
        } catch (error) {
            console.error("Failed to initialize Firebase:", error);
        }
    }, []);

    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    // Effect for fetching all data once authentication is ready
    useEffect(() => {
        if (!db || !userId || !isAuthReady) return;

        const collectionsToFetch = [
            { path: `artifacts/${appId}/users/${userId}/ibd_logs`, setter: setLogEntries, sort: true },
            { path: `artifacts/${appId}/users/${userId}/main_ibd_med/main_doc`, setter: setMainIbdMed, isDoc: true },
            { path: `artifacts/${appId}/users/${userId}/current_supplements`, setter: setSupplements }
        ];

        const unsubscribers = collectionsToFetch.map(({ path, setter, isDoc, sort }) => {
            if (isDoc) {
                return onSnapshot(doc(db, path), (docSnap) => {
                    setter(docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null);
                }, (error) => console.error(`Error fetching document from ${path}:`, error));
            } else {
                const q = query(collection(db, path));
                return onSnapshot(q, (snapshot) => {
                    let entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    if (sort) {
                       entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    }
                    setter(entries);
                }, (error) => console.error(`Error fetching collection from ${path}:`, error));
            }
        });

        return () => unsubscribers.forEach(unsub => unsub && unsub());
    }, [db, userId, isAuthReady, appId]);

    const appContextValue = { db, userId, isAuthReady, logEntries, mainIbdMed, supplements, appId };

    const renderPage = () => {
        switch (currentPage) {
            case 'dashboard': return <DashboardPage />;
            case 'log': return <LogPage />;
            case 'medications': return <MedicationManagementPage />;
            case 'doctorMode': return <DoctorModePage />;
            case 'travelMode': return <TravelModePage />;
            case 'triggerFoods': return <TriggerFoodsPage />;
            default: return <DashboardPage />;
        }
    };

    return (
        <AppContext.Provider value={appContextValue}>
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 font-sans text-gray-800 pt-8 pb-4 px-4 flex flex-col items-center justify-center"> {/* Adjusted padding-top (pt-8) */}
                <div className="w-full max-w-md bg-white rounded-xl shadow-2xl p-6"> {/* Adjusted max-w-md for phone size */}
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-indigo-700 mb-6 text-center"> IBD Health Tracker </h1> {/* Adjusted text size */}
                    <nav className="flex flex-wrap justify-center gap-1 mb-6 text-xs"> {/* Adjusted gap and text size */}
                        <NavLink onClick={() => setCurrentPage('dashboard')} active={currentPage === 'dashboard'}>Dashboard</NavLink>
                        <NavLink onClick={() => setCurrentPage('log')} active={currentPage === 'log'}>Daily Log</NavLink>
                        <NavLink onClick={() => setCurrentPage('medications')} active={currentPage === 'medications'}>Medications</NavLink>
                        <NavLink onClick={() => setCurrentPage('triggerFoods')} active={currentPage === 'triggerFoods'}>Trigger Foods (AI)</NavLink>
                        <NavLink onClick={() => setCurrentPage('doctorMode')} active={currentPage === 'doctorMode'}>Doctor Mode (AI)</NavLink>
                        <NavLink onClick={() => setCurrentPage('travelMode')} active={currentPage === 'travelMode'}>Travel Mode</NavLink>
                    </nav>
                    <div className="p-3 sm:p-4 bg-gray-50 rounded-lg shadow-inner"> {/* Adjusted padding */}
                        {renderPage()}
                    </div>
                    {userId && (
                        <div className="text-center mt-4 text-xs text-gray-500">
                            User ID: <span className="font-semibold text-indigo-600 break-all">{userId}</span>
                        </div>
                    )}
                </div>
            </div>
        </AppContext.Provider>
    );
};

const NavLink = ({ onClick, active, children }) => (
    <button onClick={onClick} className={`px-2 py-1 text-xs rounded-lg font-medium transition-all duration-300 ease-in-out ${active ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100'}`}>
        {children}
    </button>
);

// Helper to check if a medication is due today based on its frequency and start date
const isMedicationDueToday = (med, todayDate) => {
    if (!med || !med.frequency) return false;

    // Handle 'As needed' immediately
    if (med.frequency === 'As needed') {
        return false;
    }

    // For frequencies requiring a start date, ensure it's provided
    const requiresStartDate = ['Every other day', 'Weekly', 'Bi-weekly', 'Every three days', 'Every four days'].includes(med.frequency);
    if (requiresStartDate && !med.startDate) {
        // If start date is missing for these types, we can't determine if it's due
        console.warn(`Medication "${med.name}" has a recurring frequency but no start date. Cannot determine if due today.`);
        return false;
    }

    const startDate = med.startDate ? new Date(med.startDate) : null;
    if (startDate) {
        startDate.setHours(0, 0, 0, 0); // Normalize to start of the day
    }
    todayDate.setHours(0, 0, 0, 0); // Normalize today's date

    switch (med.frequency) {
        case 'Once daily':
        case 'Twice daily':
        case 'Three times daily':
            return true; // Always due daily if frequency implies daily intake
        case 'Every other day':
            if (!startDate) return false;
            const diffDaysEveryOther = Math.floor((todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            return diffDaysEveryOther >= 0 && diffDaysEveryOther % 2 === 0;
        case 'Every three days':
            if (!startDate) return false;
            const diffDaysEveryThree = Math.floor((todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            return diffDaysEveryThree >= 0 && diffDaysEveryThree % 3 === 0;
        case 'Every four days':
            if (!startDate) return false;
            const diffDaysEveryFour = Math.floor((todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            return diffDaysEveryFour >= 0 && diffDaysEveryFour % 4 === 0;
        case 'Weekly':
            if (!startDate) return false;
            // Assuming the weekly schedule aligns with the day of the week of the start date
            return todayDate.getDay() === startDate.getDay();
        case 'Bi-weekly':
            if (!startDate) return false;
            const diffDaysBiWeekly = Math.floor((todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            // Check if it's the correct day of the week AND in the correct 2-week cycle
            return todayDate.getDay() === startDate.getDay() && (Math.floor(diffDaysBiWeekly / 7) % 2 === 0);
        default:
            return false;
    }
};


const MedicationReminders = () => {
    const { mainIbdMed, supplements } = useContext(AppContext);
    const [takenMedsState, setTakenMedsState] = useState({}); // { 'medId_HH:MM': true }
    const notificationTimers = useRef({}); // To store setTimeout IDs for cleanup
    const notifiedGeneralMeds = useRef({}); // To track if general notifications were sent for today

    // Memoize today's meds to avoid re-calculating on every render
    const todaysMeds = useMemo(() => {
        const allMeds = [];
        if (mainIbdMed) allMeds.push({ ...mainIbdMed, isPrimary: true }); // Mark primary med
        allMeds.push(...supplements);

        const today = new Date();
        // Filter for meds due today
        const medsDueToday = allMeds.filter(med => isMedicationDueToday(med, new Date()));

        return medsDueToday.map(med => ({
            ...med,
            times: med.medTimes && med.medTimes.length > 0 ? med.medTimes.map(t => {
                const [hours, minutes] = t.split(':');
                const medTime = new Date(today.toISOString().slice(0, 10)); // Use today's date
                medTime.setHours(hours, minutes, 0, 0);
                return { time: t, isPast: medTime < today };
            }) : null // If no specific times, set to null
        }));
    }, [mainIbdMed, supplements]); // Re-run when `mainIbdMed` or `supplements` change

    useEffect(() => {
        if ('Notification' in window) {
            Notification.requestPermission();
        }

        const todayKey = new Date().toISOString().slice(0, 10);
        const storedTakenMeds = JSON.parse(localStorage.getItem(`takenMeds_${todayKey}`) || '{}');
        setTakenMedsState(storedTakenMeds);

        // Clear existing timers to avoid duplicates on re-renders
        for (const timerId in notificationTimers.current) {
            clearTimeout(notificationTimers.current[timerId]);
        }
        notificationTimers.current = {}; // Reset the ref

        // Reset general notifications for the new day
        if (notifiedGeneralMeds.current.date !== todayKey) {
            notifiedGeneralMeds.current = { date: todayKey };
        }


        todaysMeds.forEach(med => {
            if (med.times && med.times.length > 0) {
                // Handle timed medications
                med.times.forEach(t => {
                    const medIdentifier = `${med.id}_${t.time}`;
                    const [hours, minutes] = t.time.split(':');
                    const medDateTime = new Date();
                    medDateTime.setHours(hours, minutes, 0, 0);

                    // Check if already taken for today
                    if (storedTakenMeds[medIdentifier]) return;

                    const now = new Date();
                    const oneHourAfter = new Date(medDateTime.getTime() + 60 * 60 * 1000);
                    const twoHoursAfter = new Date(medDateTime.getTime() + 2 * 60 * 60 * 1000);

                    // Schedule first notification (1 hour after scheduled time)
                    if (oneHourAfter > now) {
                        notificationTimers.current[medIdentifier] = setTimeout(() => {
                            if (!JSON.parse(localStorage.getItem(`takenMeds_${todayKey}`) || '{}')[medIdentifier] && Notification.permission === 'granted') {
                                new Notification(`Reminder: Take your ${med.name} at ${t.time}`, {
                                    body: `It's been an hour since your scheduled dose for ${med.name}!`,
                                    icon: "https://placehold.co/64x64/000000/FFFFFF?text=💊"
                                });
                            }
                            if (twoHoursAfter > new Date()) {
                                 notificationTimers.current[`${medIdentifier}_second`] = setTimeout(() => {
                                     if (!JSON.parse(localStorage.getItem(`takenMeds_${todayKey}`) || '{}')[medIdentifier] && Notification.permission === 'granted') {
                                         new Notification(`Urgent Reminder: Take your ${med.name}!`, {
                                             body: `It's been two hours since your scheduled dose for ${med.name}. Please take it now.`,
                                             icon: "https://placehold.co/64x64/FF0000/FFFFFF?text=🚨"
                                         });
                                     }
                                     delete notificationTimers.current[`${medIdentifier}_second`];
                                 }, twoHoursAfter.getTime() - new Date().getTime());
                            }
                            delete notificationTimers.current[medIdentifier];
                        }, oneHourAfter.getTime() - now.getTime());
                    }
                });
            } else {
                // Handle general daily reminders for meds without specific times, if not already notified today
                const generalMedIdentifier = `general_${med.id}_${todayKey}`;
                if (!notifiedGeneralMeds.current[generalMedIdentifier] && Notification.permission === 'granted') {
                    // Send a general notification once for the day
                    new Notification(`Reminder: Take your ${med.name} today`, {
                        body: `Your ${med.name} is due today (${med.frequency}).`,
                        icon: "https://placehold.co/64x64/000000/FFFFFF?text=💊"
                    });
                    notifiedGeneralMeds.current[generalMedIdentifier] = true;
                }
            }
        });

        // Cleanup timers on unmount
        return () => {
            for (const timerId in notificationTimers.current) {
                clearTimeout(notificationTimers.current[timerId]);
            }
        };
    }, [todaysMeds]); // Re-run when `todaysMeds` changes (medication list or when a new day starts)


    const handleMarkTaken = (medId, time) => {
        const medIdentifier = `${medId}_${time}`;
        const todayKey = new Date().toISOString().slice(0, 10);
        
        setTakenMedsState(prev => {
            const newState = { ...prev, [medIdentifier]: true };
            localStorage.setItem(`takenMeds_${todayKey}`, JSON.stringify(newState));
            return newState;
        });

        // Clear any pending notifications for this specific dose
        if (notificationTimers.current[medIdentifier]) {
            clearTimeout(notificationTimers.current[medIdentifier]);
            delete notificationTimers.current[medIdentifier];
        }
        if (notificationTimers.current[`${medIdentifier}_second`]) {
            clearTimeout(notificationTimers.current[`${medIdentifier}_second`]);
            delete notificationTimers.current[`${medIdentifier}_second`];
        }
    };

    if (todaysMeds.length === 0) {
        return null; // Don't show the reminder section if no meds are due today
    }

    return (
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg shadow-sm mb-4"> {/* Adjusted padding and margin */}
             <h3 className="text-base font-semibold text-indigo-800 mb-2">Today's Medication Schedule</h3> {/* Adjusted text size */}
             <ul className="space-y-1"> {/* Adjusted space-y */}
                 {todaysMeds.length === 0 ? (
                     <li className="text-xs text-gray-600">No time-specific medications scheduled for today. Check your Medication Management page for general frequency reminders.</li>
                 ) : (
                     todaysMeds.map(med => (
                         <li key={med.id || med.name} className="text-xs"> {/* Adjusted text size */}
                             <strong className="text-indigo-700">{med.name}</strong> ({med.frequency})
                             {med.times && med.times.length > 0 ? (
                                 med.times.map(t => {
                                     const medIdentifier = `${med.id}_${t.time}`;
                                     const isTaken = takenMedsState[medIdentifier];
                                     const scheduledTimeMillis = new Date(new Date().toDateString() + ' ' + t.time).getTime();
                                     const nowMillis = Date.now();
                                     // A dose is "past" if its scheduled time is before now.
                                     const isPastScheduledTime = scheduledTimeMillis < nowMillis;
                                     
                                     return (
                                         <span key={t.time} className="ml-1"> {/* Adjusted margin */}
                                             {isTaken ? (
                                                 <span className="px-1.5 py-0.5 rounded bg-green-200 text-green-800 text-xs"> {/* Adjusted padding and text size */}
                                                     {t.time} (Taken)
                                                 </span>
                                             ) : isPastScheduledTime ? (
                                                 <span className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 line-through text-xs"> {/* Adjusted padding and text size */}
                                                     {t.time} (Missed)
                                                 </span>
                                             ) : (
                                                 <button
                                                     onClick={() => handleMarkTaken(med.id, t.time)}
                                                     className="px-1.5 py-0.5 rounded font-semibold bg-blue-100 text-blue-800 hover:bg-blue-200 text-xs" // Adjusted padding and text size
                                                 >
                                                     {t.time} (Mark Taken)
                                                 </button>
                                             )}
                                         </span>
                                     );
                                 })
                             ) : (
                                 <span className="ml-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-xs">Due Today</span>
                             )}
                         </li>
                     ))
                 )}
             </ul>
        </div>
    );
}

const DashboardPage = () => {
    const { logEntries, isAuthReady } = useContext(AppContext);
    const DAYS_TO_SHOW = 7;

    const { chartData, poopSummary, symptomSummary, recentFoodEntries } = useMemo(() => {
        const data = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const symptomTotals = Object.keys(symptomColors).reduce((acc, key) => ({...acc, [key]: {total: 0, count: 0}}), {});
        const poopCounts = {};

        for (let i = DAYS_TO_SHOW - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateString = date.toISOString().split('T')[0];

            const dailyData = {
                date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                ...Object.keys(bristolColors).reduce((acc, key) => ({...acc, [key]: 0 }), {}),
                ...Object.keys(symptomColors).reduce((acc, key) => ({...acc, [`${key}Severity`]: 0 }), {}),
            };

            const logsForDay = logEntries.filter(entry => entry.date === dateString);
            
            let totalSeverity = 0;
            let symptomsLoggedToday = 0;

            logsForDay.forEach(entry => {
                if (entry.logType === 'poop' && entry.poopType) {
                    dailyData[entry.poopType] = (dailyData[entry.poopType] || 0) + 1;
                    poopCounts[entry.poopType] = (poopCounts[entry.poopType] || 0) + 1;
                }
                if (entry.logType === 'symptoms') {
                    for (const symptomKey in entry.symptoms) {
                        if(entry.symptoms[symptomKey].checked) {
                            const severity = entry.symptoms[symptomKey].severity;
                            const severityKey = `${symptomKey}Severity`;
                            dailyData[severityKey] = Math.max(dailyData[severityKey] || 0, severity);
                            
                            symptomTotals[symptomKey].total += severity;
                            symptomTotals[symptomKey].count += 1;
                            totalSeverity += severity;
                            symptomsLoggedToday++;
                        }
                    }
                }
            });
            dailyData.averageSeverity = symptomsLoggedToday > 0 ? (totalSeverity / symptomsLoggedToday).toFixed(1) : 0;
            data.push(dailyData);
        }

        // --- Handle multiple most common poop types ---
        const maxCount = Object.values(poopCounts).length > 0 ? Math.max(...Object.values(poopCounts)) : 0;
        const mostCommonPoops = Object.keys(poopCounts).filter(type => poopCounts[type] === maxCount);
        const mostCommonPoopDisplay = mostCommonPoops.length > 0 ? mostCommonPoops.join(' & ') : 'N/A';
        
        const symptomAverages = Object.keys(symptomTotals).map(key => ({
            name: key.replace(/([A-Z])/g, ' $1').trim(),
            average: symptomTotals[key].count > 0 ? (symptomTotals[key].total / symptomTotals[key].count).toFixed(1) : 'N/A'
        }));

        const pastFoodEntries = logEntries
            .filter(entry => entry.logType === 'food' && entry.food && entry.food.length > 0)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 5)
            .map(entry => ({
                id: entry.id,
                timestamp: entry.timestamp,
                food: entry.food,
            }));
        
        return { chartData: data, poopSummary: { mostCommon: mostCommonPoopDisplay }, symptomSummary: { averages: symptomAverages }, recentFoodEntries: pastFoodEntries };
    }, [logEntries]);


    if (!isAuthReady) {
        return <div className="text-center p-8 text-lg text-indigo-600 animate-pulse">Loading user data...</div>;
    }

    return (
        <div className="space-y-6"> {/* Adjusted space-y */}
            <MedicationReminders />
            <div className="bg-white p-3 rounded-lg shadow-md border border-gray-200"> {/* Adjusted padding */}
                <h3 className="text-base font-semibold text-gray-700 mb-3">Past Five Food Entries</h3> {/* Adjusted text size */}
                {recentFoodEntries.length === 0 ? (
                    <p className="text-sm text-gray-600">No food entries logged yet.</p>
                ) : (
                    <ul className="space-y-1"> {/* Adjusted space-y */}
                        {recentFoodEntries.map(entry => (
                            <li key={entry.id} className="text-xs"> {/* Adjusted text size */}
                                <strong className="text-indigo-700">{formatTimestamp(entry.timestamp)}:</strong> {formatFood(entry.food)}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <h2 className="text-xl font-bold text-indigo-700 mb-3">Weekly Dashboard</h2> {/* Adjusted text size and margin */}
            
            <div className="bg-white p-3 rounded-lg shadow-md border border-gray-200"> {/* Adjusted padding */}
                <h3 className="text-base font-semibold text-gray-700 mb-3">Daily Bowel Movements (Last {DAYS_TO_SHOW} Days)</h3> {/* Adjusted text size and margin */}
                <ResponsiveContainer width="100%" height={250}> {/* Adjusted height */}
                    <BarChart data={chartData} barCategoryGap="10%">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" style={{ fontSize: '0.75rem' }}/> {/* Adjusted font size */}
                        <YAxis allowDecimals={false} style={{ fontSize: '0.75rem' }}> {/* Adjusted font size */}
                            <Label value="Times Gone" angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fontSize: '0.75rem' }} /> {/* Adjusted font size */}
                        </YAxis>
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: '0.75rem' }} /> {/* Adjusted font size */}
                        {Object.entries(bristolColors).map(([type, color]) => (
                             <Bar key={type} dataKey={type} fill={color} />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-600 mt-2 text-center font-medium">Most Common Poop Type (Last 7 Days): <span className="font-bold text-indigo-600">{poopSummary.mostCommon}</span></p> {/* Adjusted text size */}
            </div>

            <div className="bg-white p-3 rounded-lg shadow-md border border-gray-200"> {/* Adjusted padding */}
                <h3 className="text-base font-semibold text-gray-700 mb-3">Daily Symptom Severity (Last {DAYS_TO_SHOW} Days)</h3> {/* Adjusted text size and margin */}
                <ResponsiveContainer width="100%" height={250}> {/* Adjusted height */}
                    <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" style={{ fontSize: '0.75rem' }} /> {/* Adjusted font size */}
                        <YAxis domain={[0, 10]} style={{ fontSize: '0.75rem' }}> {/* Adjusted font size */}
                            <Label value="Max Severity" angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fontSize: '0.75rem' }} /> {/* Adjusted font size */}
                        </YAxis>
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: '0.75rem' }} /> {/* Adjusted font size */}
                        {Object.entries(symptomColors).map(([symptom, color]) => (
                            <Bar 
                                key={symptom} 
                                dataKey={`${symptom}Severity`} 
                                name={symptom.charAt(0).toUpperCase() + symptom.slice(1).replace(/([A-Z])/g, ' $1').trim()} 
                                fill={color} 
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
                 <div className="text-xs text-gray-600 mt-3 text-center"> {/* Adjusted text size and margin */}
                    <p className="font-medium mb-1">Average Severity (Last 7 Days):</p>
                    <div className="flex flex-wrap justify-center gap-x-2 gap-y-1"> {/* Adjusted gap */}
                        {symptomSummary.averages.map(s => (
                            <span key={s.name} className="capitalize text-gray-700">
                                {s.name}: <strong className="text-indigo-600">{s.average}</strong>
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const LogPage = () => {
    const { db, userId, isAuthReady, appId } = useContext(AppContext);
    const [foods, setFoods] = useState([{ name: '', quantity: '', measurement: '' }]);
    const [foodLogTime, setFoodLogTime] = useState(''); // RE-INTRODUCED this state
    const [poopType, setPoopType] = useState('');
    const [poopLogTime, setPoopLogTime] = useState('');
    const [symptoms, setSymptoms] = useState({ bloating: { checked: false, severity: 0 }, cramps: { checked: false, severity: 0 }, urgency: { checked: false, severity: 0 }, fatigue: { checked: false, severity: 0 }, nausea: { checked: false, severity: 0 }, jointPain: { checked: false, severity: 0 }, stomachPain: { checked: false, severity: 0 }, headaches: { checked: false, severity: 0 }});
    const [symptomsLogTime, setSymptomsLogTime] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');
    
    // Form options
    const bristolStoolChart = Object.entries(fullBristolDescriptions).map(([type, description]) => ({type, description}));
    const foodMeasurements = [ 'grams', 'kilograms', 'cups', 'tablespoons', 'teaspoons', 'ounces', 'pounds', 'pieces', 'servings', 'slices', 'bowls', 'plates', 'other' ];

    const saveLogEntry = async (logType, data, selectedTime) => {
        if (!db || !userId) {
            setMessage('Database not ready. Please wait.');
            return false;
        }
        setIsLoading(true);
        setMessage('');
        try {
            // UPDATED logic: Combine current date with selected time. If no time selected, use current full timestamp.
            const logTimestamp = selectedTime ? new Date(new Date().toDateString() + ' ' + selectedTime).toISOString() : new Date().toISOString();
            const logDate = new Date(logTimestamp).toISOString().split('T')[0];
            const logEntry = { date: logDate, timestamp: logTimestamp, logType, ...data };
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/ibd_logs`), logEntry);
            setMessage(`${logType.charAt(0).toUpperCase() + logType.slice(1)} log saved successfully!`);
            return true;
        } catch (error) {
            console.error(`Error saving ${logType} log:`, error);
            setMessage(`Failed to save ${logType} log: ${error.message}`);
            return false;
        } finally {
            setIsLoading(false);
            setTimeout(() => setMessage(''), 3000);
        }
    };

    const getCurrentTime = () => new Date().toTimeString().slice(0, 5); // KEEP this for the TimeInput component's 'Now' button

    const handleFoodSubmit = async (e) => {
        e.preventDefault();
        const validFoods = foods.filter(f => f.name.trim() !== '');
        if (validFoods.length === 0) return setMessage('Please enter at least one food item.');
        // Pass foodLogTime to saveLogEntry
        const success = await saveLogEntry('food', { food: validFoods }, foodLogTime);
        if (success) {
            setFoods([{ name: '', quantity: '', measurement: '' }]);
            setFoodLogTime(''); // RESET foodLogTime
        }
    };

    const handlePoopSubmit = async (e) => {
        e.preventDefault();
        if (!poopType) return setMessage('Please select a poop type.');
        const success = await saveLogEntry('poop', { poopType }, poopLogTime);
        if (success) {
            setPoopType('');
            setPoopLogTime('');
        }
    };
    
    const handleSymptomsSubmit = async (e) => {
        e.preventDefault();
        if (!Object.values(symptoms).some(s => s.checked)) return setMessage('Please select at least one symptom.');
        const success = await saveLogEntry('symptoms', { symptoms }, symptomsLogTime);
        if (success) {
             setSymptoms(Object.keys(symptoms).reduce((acc, key) => ({...acc, [key]: {checked: false, severity: 0}}), {}));
             setSymptomsLogTime('');
        }
    };

    // Food form handlers
    const handleFoodChange = (index, field, value) => {
        const newFoods = [...foods];
        newFoods[index][field] = value;
        setFoods(newFoods);
    };
    const addFoodItem = () => setFoods([...foods, { name: '', quantity: '', measurement: '' }]);
    const removeFoodItem = (index) => setFoods(foods.filter((_, i) => i !== index));

    // Symptom form handlers
    const handleSymptomCheckChange = (e) => {
        const { name, checked } = e.target;
        setSymptoms(p => ({...p, [name]: {...p[name], checked, severity: checked ? (p[name].severity === 0 ? 1 : p[name].severity) : 0}}));
    };
    const handleSeverityChange = (e) => {
        const { name, value } = e.target;
        setSymptoms(p => ({...p, [name]: {...p[name], severity: parseInt(value, 10)}}));
    };

    if (!isAuthReady) return <div className="text-center p-8 text-lg text-indigo-600 animate-pulse">Loading...</div>;

    return (
        <div className="space-y-6"> {/* Adjusted space-y */}
            <h2 className="text-xl font-bold text-indigo-700 mb-3">Daily Log</h2> {/* Adjusted text size and margin */}
            {message && <div className={`p-2 rounded-lg text-center text-sm ${message.includes('Failed') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{message}</div>} {/* Adjusted padding and text size */}
            
            {/* Forms */}
            <div className="p-3 bg-white rounded-lg shadow-md border"> {/* Adjusted padding */}
                <LogForm title="Food Log" onSubmit={handleFoodSubmit} isLoading={isLoading} isAuthReady={isAuthReady} buttonText="Save Food Log">
                    {foods.map((item, i) => <FoodItem key={i} index={i} item={item} onChange={handleFoodChange} onRemove={removeFoodItem} measurements={foodMeasurements} showRemove={foods.length > 1} />)}
                    <button type="button" onClick={addFoodItem} className="mt-2 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg font-semibold hover:bg-blue-200 text-sm">Add Another Food Item</button> {/* Adjusted padding and text size */}
                    <TimeInput value={foodLogTime} onChange={setFoodLogTime} />
                </LogForm>
            </div>
            <div className="p-3 bg-white rounded-lg shadow-md border"><LogForm title="Poop Log" onSubmit={handlePoopSubmit} isLoading={isLoading} isAuthReady={isAuthReady} buttonText="Save Poop Log"> {/* Adjusted padding */}
                <select value={poopType} onChange={e => setPoopType(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg shadow-sm text-sm" required> {/* Adjusted padding and text size */}
                    <option value="">Select a type...</option>
                    {bristolStoolChart.map(i => <option key={i.type} value={i.type}>{i.type}: {i.description}</option>)}
                </select>
                <TimeInput value={poopLogTime} onChange={setPoopLogTime} />
            </LogForm></div>
            <div className="p-3 bg-white rounded-lg shadow-md border"><LogForm title="Symptoms Log" onSubmit={handleSymptomsSubmit} isLoading={isLoading} isAuthReady={isAuthReady} buttonText="Save Symptoms Log"> {/* Adjusted padding */}
                <div className="grid grid-cols-1 sm:grid-cols-1 gap-3"> {/* Adjusted gap, removed sm:grid-cols-2 for smaller screens */}
                    {Object.keys(symptoms).map(key => <SymptomItem key={key} symptomKey={key} symptom={symptoms[key]} onCheckChange={handleSymptomCheckChange} onSeverityChange={handleSeverityChange} />)}
                </div>
                <TimeInput value={symptomsLogTime} onChange={setSymptomsLogTime} />
            </LogForm></div>
        </div>
    );
};

// --- LogPage Sub-components ---
const LogForm = ({ title, onSubmit, isLoading, isAuthReady, buttonText, children }) => (
    <form onSubmit={onSubmit} className="space-y-4">
        <h3 className="text-base font-semibold text-gray-700 mb-3">{title}</h3> {/* Adjusted text size and margin */}
        {children}
        <button type="submit" disabled={isLoading || !isAuthReady} className="w-full bg-indigo-600 text-white p-2.5 rounded-lg font-semibold text-base hover:bg-indigo-700 disabled:opacity-50"> {/* Adjusted padding and text size */}
            {isLoading ? 'Saving...' : buttonText}
        </button>
    </form>
);
const FoodItem = ({ index, item, onChange, onRemove, measurements, showRemove }) => (
    <div className="flex flex-col gap-2 mb-3 p-2 bg-gray-50 rounded-lg border"> {/* Adjusted gap, margin, and padding */}
        <input type="text" value={item.name} onChange={e => onChange(index, 'name', e.target.value)} placeholder={`Food Item ${index + 1}`} className="w-full p-2 border border-gray-300 rounded-lg text-sm" /> {/* Adjusted padding and text size */}
        <div className="flex gap-2"> {/* Adjusted gap */}
            <input type="number" value={item.quantity} onChange={e => onChange(index, 'quantity', e.target.value)} placeholder="Dosage Amount" className="w-full p-2 border border-gray-300 rounded-lg text-sm" min="0" step="0.1" /> {/* Adjusted padding and text size */}
            <select value={item.measurement} onChange={e => onChange(index, 'measurement', e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg bg-white text-sm"> {/* Adjusted padding and text size */}
                <option value="">Unit</option>
                {measurements.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
        </div>
        {showRemove && <button type="button" onClick={() => onRemove(index)} className="p-1.5 bg-red-100 text-red-600 rounded-md hover:bg-red-200 self-start text-xs">Remove</button>} {/* Adjusted padding and text size */}
    </div>
);
const SymptomItem = ({ symptomKey, symptom, onCheckChange, onSeverityChange }) => (
    <div className="p-2 border rounded-lg bg-gray-50">
        <div className="flex items-center"><input type="checkbox" id={`symptom-${symptomKey}`} name={symptomKey} checked={symptom.checked} onChange={onCheckChange} className="h-4 w-4 text-indigo-600 rounded border-gray-300" /> {/* Adjusted size */}
            <label htmlFor={`symptom-${symptomKey}`} className="ml-2 text-sm text-gray-700 capitalize font-medium">{symptomKey.replace(/([A-Z])/g, ' $1').trim()}</label> {/* Adjusted margin and text size */}
        </div>
        {symptom.checked && <div>
            <label htmlFor={`severity-${symptomKey}`} className="block text-xs font-medium text-gray-600 my-1">Severity: {symptom.severity}</label> {/* Adjusted text size */}
            <input type="range" id={`severity-${symptomKey}`} name={symptomKey} min="1" max="10" value={symptom.severity} onChange={onSeverityChange} className="w-full h-1.5 bg-gray-200 rounded-lg" /> {/* Adjusted height */}
        </div>}
    </div>
);
const TimeInput = ({ value, onChange }) => (
    <div className="flex items-end gap-2 pt-3 border-t mt-3"> {/* Adjusted gap, padding, and margin */}
        <div className="flex-1"><label className="block text-sm font-medium text-gray-700 mb-1">Time of log:</label><input type="time" value={value} onChange={e => onChange(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm" /></div> {/* Adjusted padding and text size */}
        <button type="button" onClick={() => onChange(new Date().toTimeString().slice(0,5))} className="px-3 py-1.5 bg-gray-200 rounded-lg font-semibold hover:bg-gray-300 text-sm">Now</button> {/* Adjusted padding and text size */}
    </div>
);


const MedicationManagementPage = () => {
    const { db, userId, isAuthReady, mainIbdMed, supplements, appId } = useContext(AppContext);
    const [ibdMedForm, setIbdMedForm] = useState({ name: '', dosageAmount: '', dosageUnit: '', frequency: '', medTimes: [], startDate: '' });
    const [newSupplementForm, setNewSupplementForm] = useState({ name: '', dosageAmount: '', dosageUnit: '', frequency: '', medTimes: [], startDate: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');

    const frequencies = ['Once daily', 'Twice daily', 'Three times daily', 'Every other day', 'Every three days', 'Every four days', 'Weekly', 'Bi-weekly', 'As needed'];
    const dosageUnits = ['mg', 'g', 'pills', 'drops', 'other'];

    useEffect(() => {
        // Initialize the form with mainIbdMed data if available
        if (mainIbdMed) {
            setIbdMedForm({
                name: mainIbdMed.name || '',
                dosageAmount: mainIbdMed.dosageAmount || '',
                dosageUnit: mainIbdMed.dosageUnit || '',
                frequency: mainIbdMed.frequency || '',
                medTimes: mainIbdMed.medTimes || [],
                startDate: mainIbdMed.startDate || ''
            });
        } else {
            setIbdMedForm({ name: '', dosageAmount: '', dosageUnit: '', frequency: '', medTimes: [], startDate: '' });
        }
    }, [mainIbdMed]);

    const showMessage = (msg) => {
        setMessage(msg);
        setTimeout(() => setMessage(''), 3000);
    }
    
    // Handler for saving/updating Main IBD Medication
    const handleSaveIbdMed = async (e) => {
        e.preventDefault();
        if (!ibdMedForm.name || !ibdMedForm.dosageAmount || !ibdMedForm.dosageUnit || !ibdMedForm.frequency) {
            showMessage('Please fill all required fields for Main IBD Medication.');
            return;
        }

        const requiresTimes = ['Once daily', 'Twice daily', 'Three times daily', 'Every other day', 'Every three days', 'Every four days', 'Weekly', 'Bi-weekly'].includes(ibdMedForm.frequency);
        if (requiresTimes && ibdMedForm.medTimes.some(time => time.trim() === '') && ibdMedForm.medTimes.length === 0) { // Check length to avoid error if array is empty
             showMessage('Please fill all required medication times.');
             return;
        }
        
        const requiresStartDate = ['Every other day', 'Every three days', 'Every four days', 'Weekly', 'Bi-weekly'].includes(ibdMedForm.frequency);
        if (requiresStartDate && !ibdMedForm.startDate) {
            showMessage('Please select a Start Date for this frequency.');
            return;
        }

        if (!db || !userId) {
            showMessage('Database not ready.');
            return;
        }
        
        setIsLoading(true);
        const medDocRef = doc(db, `artifacts/${appId}/users/${userId}/main_ibd_med/main_doc`);
        
        try {
            await setDoc(medDocRef, ibdMedForm, { merge: true });
            showMessage('Primary IBD Medication saved successfully!');
        } catch (error) {
            console.error("Error saving main IBD medication:", error);
            showMessage(`Failed to save Primary IBD Medication: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    // Handler for adding a new supplement
    const handleAddSupplement = async (e) => {
        e.preventDefault();
        if (!newSupplementForm.name || !newSupplementForm.dosageAmount || !newSupplementForm.dosageUnit || !newSupplementForm.frequency) {
            showMessage('Please fill all required fields for the new supplement (Name, Dosage, Frequency).');
            return;
        }
        
        const requiresTimes = ['Once daily', 'Twice daily', 'Three times daily', 'Every other day', 'Every three days', 'Every four days', 'Weekly', 'Bi-weekly'].includes(newSupplementForm.frequency);
        if (requiresTimes && newSupplementForm.medTimes.some(time => time.trim() === '') && newSupplementForm.medTimes.length === 0) { // Check length to avoid error if array is empty
             showMessage('Please fill all required supplement times.');
             return;
         }

        const requiresStartDate = ['Every other day', 'Every three days', 'Every four days', 'Weekly', 'Bi-weekly'].includes(newSupplementForm.frequency);
        if (requiresStartDate && !newSupplementForm.startDate) {
            showMessage('Please select a Start Date for this frequency.');
            return;
        }

        if (!db || !userId) {
            showMessage('Database not ready.');
            return;
        }

        setIsLoading(true);
        try {
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/current_supplements`), newSupplementForm);
            showMessage('Supplement added successfully!');
            setNewSupplementForm({ name: '', dosageAmount: '', dosageUnit: '', frequency: '', medTimes: [], startDate: '' }); // Reset form
        } catch (error) {
            console.error("Error adding supplement:", error);
            showMessage(`Failed to add supplement: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleRemoveIbdMed = async () => {
        if (!db || !userId) return;
        setIsLoading(true);
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/main_ibd_med`, 'main_doc'));
            setMainIbdMed(null); // Clear local state after deletion
            showMessage('IBD Medication removed.');
        } catch (error) {
            console.error("Error removing main IBD medication:", error);
            showMessage(`Error removing: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveSupplement = async (id) => {
        if (!db || !userId) return;
        setIsLoading(true);
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/current_supplements`, id));
            showMessage('Supplement removed.');
        } catch (error) {
                console.error("Error removing supplement:", error);
                showMessage(`Error removing: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isAuthReady) return <div className="text-center p-8 text-lg text-indigo-600 animate-pulse">Loading...</div>;

    return (
        <div className="space-y-6"> {/* Adjusted space-y */}
            <h2 className="text-xl font-bold text-indigo-700">Medication & Supplement Management</h2> {/* Adjusted text size */}
            {message && <div className={`p-2 rounded-lg text-center text-sm ${message.includes('Error') || message.includes('Failed') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{message}</div>} {/* Adjusted padding and text size */}

            <div className="bg-white p-3 rounded-lg shadow-md border"> {/* Adjusted padding */}
                <h3 className="text-base font-semibold text-indigo-700 mb-3">Primary IBD Medication</h3> {/* Adjusted text size and margin */}
                {mainIbdMed && mainIbdMed.name ? (
                    <div className="flex flex-col sm:flex-row justify-between items-center p-2 bg-gray-50 rounded-lg mb-3 text-sm"> {/* Adjusted padding, margin, and text size */}
                        <p className="mb-1 sm:mb-0">{formatCurrentMedication(mainIbdMed)}</p> {/* Adjusted margin */}
                        <button onClick={handleRemoveIbdMed} disabled={isLoading} className="px-2 py-1 bg-red-100 text-red-600 rounded-md hover:bg-red-200 text-xs">Remove</button> {/* Adjusted padding and text size */}
                    </div>
                ) : (
                    <p className="text-sm text-gray-600 mb-3">No primary IBD medication set. Please add one below.</p>
                )}
                
                <form onSubmit={handleSaveIbdMed} className="space-y-3"> {/* Adjusted space-y */}
                    <MedicationFormFields form={ibdMedForm} setForm={setIbdMedForm} frequencies={frequencies} dosageUnits={dosageUnits} isPrimary={true} />
                    <button type="submit" disabled={isLoading} className="w-full bg-indigo-600 text-white p-2.5 rounded-lg font-semibold text-base hover:bg-indigo-700 disabled:opacity-50"> {/* Adjusted padding and text size */}
                        {isLoading ? 'Saving...' : (mainIbdMed && mainIbdMed.name ? 'Update IBD Medication' : 'Set IBD Medication')}
                    </button>
                </form>
            </div>

            <div className="bg-white p-3 rounded-lg shadow-md border"> {/* Adjusted padding */}
                <h3 className="text-base font-semibold text-indigo-700 mb-3">Current Supplements</h3> {/* Adjusted text size and margin */}
                <div className="space-y-2 mb-4"> {/* Adjusted space-y and margin */}
                    {supplements.length === 0 ? (
                        <p className="text-sm text-gray-600">No supplements added yet.</p>
                    ) : (
                        supplements.map(sup => (
                            <div key={sup.id} className="flex flex-col sm:flex-row justify-between items-center p-2 bg-gray-50 rounded-lg text-sm"> {/* Adjusted padding and text size */}
                                <p className="mb-1 sm:mb-0">{formatCurrentMedication(sup)}</p> {/* Adjusted margin */}
                                <button onClick={() => handleRemoveSupplement(sup.id)} disabled={isLoading} className="px-2 py-1 bg-red-100 text-red-600 rounded-md hover:bg-red-200 text-xs">Remove</button> {/* Adjusted padding and text size */}
                            </div>
                        ))
                    )}
                </div>

                <h4 className="text-sm font-semibold text-gray-700 mb-2">Add New Supplement</h4> {/* Adjusted text size and text size */}
                <form onSubmit={handleAddSupplement} className="space-y-3"> {/* Adjusted space-y */}
                    <MedicationFormFields form={newSupplementForm} setForm={setNewSupplementForm} frequencies={frequencies} dosageUnits={dosageUnits} isPrimary={false} />
                    <button type="submit" disabled={isLoading} className="w-full bg-blue-600 text-white p-2.5 rounded-lg font-semibold text-base hover:bg-blue-700 disabled:opacity-50"> {/* Adjusted padding and text size */}
                        {isLoading ? 'Adding...' : 'Add Supplement'}
                    </button>
                </form>
            </div>
        </div>
    );
};

// --- Medication Management Sub-components ---
const MedicationFormFields = ({ form, setForm, frequencies, dosageUnits, isPrimary }) => {
    const handleMedTimeChange = (index, value) => {
        const newMedTimes = [...form.medTimes];
        newMedTimes[index] = value;
        setForm({ ...form, medTimes: newMedTimes });
    };

    // Define which frequencies require specific times
    const requiresSpecificTimesCount = (freq) => {
        switch (freq) {
            case 'Once daily': return 1;
            case 'Twice daily': return 2;
            case 'Three times daily': return 3;
            case 'Every other day':
            case 'Every three days':
            case 'Every four days':
            case 'Weekly':
            case 'Bi-weekly': return 1; // These also require a single time
            default: return 0;
        }
    };
    const numRequiredTimes = requiresSpecificTimesCount(form.frequency);
    const showTimeInputs = numRequiredTimes > 0;

    // Define which frequencies require a start date
    const requiresStartDate = ['Every other day', 'Every three days', 'Every four days', 'Weekly', 'Bi-weekly'];
    const showStartDateInput = requiresStartDate.includes(form.frequency);


    const handleFrequencyChange = (e) => {
        const newFrequency = e.target.value;
        let updatedMedTimes = [];
        let updatedStartDate = form.startDate; // Keep current start date by default

        const newNumRequiredTimes = requiresSpecificTimesCount(newFrequency);

        // Auto-populate time slots based on new frequency if needed
        if (newNumRequiredTimes > 0) {
            if (newFrequency === 'Once daily') {
                updatedMedTimes = ['09:00'];
            } else if (newFrequency === 'Twice daily') {
                updatedMedTimes = ['09:00', '21:00'];
            } else if (newFrequency === 'Three times daily') {
                updatedMedTimes = ['08:00', '14:00', '20:00'];
            } else { // For every other day, weekly etc.
                updatedMedTimes = ['09:00']; // Only one time slot for these
            }
        }
        // If 'As needed', updatedMedTimes remains empty []

        // Clear startDate if the new frequency doesn't require it
        if (!requiresStartDate.includes(newFrequency)) {
            updatedStartDate = '';
        }

        setForm(prevForm => ({
            ...prevForm,
            frequency: newFrequency,
            medTimes: updatedMedTimes,
            startDate: updatedStartDate
        }));
    };

    return (
        <>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Medication/Supplement Name" className="w-full p-2 border border-gray-300 rounded-lg text-sm" required /> {/* Adjusted padding and text size */}
            <div className="flex gap-2"> {/* Adjusted gap */}
                <input type="number" value={form.dosageAmount} onChange={e => setForm({ ...form, dosageAmount: e.target.value })} placeholder="Dosage Amount" className="w-full p-2 border border-gray-300 rounded-lg text-sm" min="0" step="0.1" required /> {/* Adjusted padding and text size */}
                <select value={form.dosageUnit} onChange={e => setForm({ ...form, dosageUnit: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg bg-white text-sm" required> {/* Adjusted padding and text size */}
                    <option value="">Unit</option>
                    {dosageUnits.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                </select>
            </div>
            <select value={form.frequency} onChange={handleFrequencyChange} className="w-full p-2 border border-gray-300 rounded-lg bg-white text-sm" required> {/* Adjusted padding and text size */}
                <option value="">Frequency</option>
                {frequencies.map(freq => <option key={freq} value={freq}>{freq}</option>)}
            </select>

            {showTimeInputs && (
                <div className="space-y-1"> {/* Adjusted space-y */}
                    <label className="block text-xs font-medium text-gray-700"> {/* Adjusted text size */}
                        Specific Times (Required)
                    </label>
                    {Array.from({ length: numRequiredTimes }).map((_, i) => (
                        <div key={i} className="flex items-center gap-1"> {/* Adjusted gap */}
                            <input
                                type="time"
                                value={form.medTimes[i] || ''}
                                onChange={e => handleMedTimeChange(i, e.target.value)}
                                className="p-1.5 border rounded-lg flex-grow text-sm" // Adjusted padding and text size
                                required
                            />
                        </div>
                    ))}
                    {numRequiredTimes > 0 && form.medTimes.length === 0 && (
                         <p className="text-red-500 text-xs mt-1">Please select a frequency to auto-populate time slots.</p>
                    )}
                </div>
            )}
            
            {showStartDateInput && (
                <div className="space-y-1"> {/* Adjusted space-y */}
                    <label htmlFor={`${isPrimary ? 'ibd' : 'sup'}-start-date`} className="block text-xs font-medium text-gray-700"> {/* Adjusted text size */}
                        Start Date (Required)
                    </label>
                    <input
                        type="date"
                        id={`${isPrimary ? 'ibd' : 'sup'}-start-date`}
                        value={form.startDate}
                        onChange={e => setForm({ ...form, startDate: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg text-sm" // Adjusted padding and text size
                        required
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        This date helps track reminders for non-daily frequencies (e.g., every other day, weekly).
                    </p>
                </div>
            )}
        </>
    );
};

const DoctorModePage = () => {
    const { logEntries, mainIbdMed, supplements, userId, isAuthReady } = useContext(AppContext);
    const [response, setResponse] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [selectedLogs, setSelectedLogs] = useState([]);
    const [message, setMessage] = useState('');

    // Pre-select logs based on "Smart Select" logic
    const handleSmartSelectLogs = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize to start of today

        const fourteenDaysAgo = new Date(today);
        fourteenDaysAgo.setDate(today.getDate() - 13); // Go back 13 days to include 14 days total

        const smartSelected = logEntries.filter(entry => {
            const entryDate = new Date(entry.timestamp);
            return entryDate >= fourteenDaysAgo && (entry.logType === 'food' || entry.logType === 'symptoms' || entry.logType === 'poop');
        }).map(entry => entry.id);

        setSelectedLogs(smartSelected);
        if (smartSelected.length > 0) {
            setMessage('Relevant logs from the past 14 days have been selected for analysis.');
        } else {
            setMessage('No relevant logs found in the past 14 days. Please log some data.');
        }
    };

    const toggleLogSelection = (id) => {
        setSelectedLogs(prev => 
            prev.includes(id) ? prev.filter(logId => logId !== id) : [...prev, id]
        );
    };

    const generateReport = async () => {
        if (!userId) {
            setMessage("Please wait for user authentication to complete.");
            return;
        }

        setIsLoading(true);
        setResponse('');
        setMessage('');

        try {
            const relevantLogs = logEntries.filter(entry => selectedLogs.includes(entry.id));

            if (relevantLogs.length === 0) {
                setMessage("Please select at least one log entry to generate a report.");
                setIsLoading(false);
                return;
            }

            // Determine the date range of selected logs for the prompt
            const sortedLogs = [...relevantLogs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const firstLogDate = sortedLogs.length > 0 ? new Date(sortedLogs[0].timestamp).toLocaleDateString() : 'N/A';
            const lastLogDate = sortedLogs.length > 0 ? new Date(sortedLogs[sortedLogs.length - 1].timestamp).toLocaleDateString() : 'N/A';
            const dateRangeText = firstLogDate === lastLogDate ? `on ${firstLogDate}` : `from ${firstLogDate} to ${lastLogDate}`;


            // Format data for the LLM
            const formattedLogs = relevantLogs.map(entry => {
                let details = '';
                if (entry.logType === 'food') {
                    details = `Food: ${formatFood(entry.food)}`;
                } else if (entry.logType === 'poop') {
                    details = `Poop Type: ${entry.poopType} (${fullBristolDescriptions[entry.poopType]})`;
                } else if (entry.logType === 'symptoms') {
                    details = `Symptom Severity: ${formatSymptoms(entry.symptoms)}`;
                }
                return `Date: ${formatTimestamp(entry.timestamp)}, Type: ${entry.logType}, Details: ${details}`;
            }).join('\n');

            const medicationsInfo = mainIbdMed ? `Primary IBD Medication: ${formatCurrentMedication(mainIbdMed)}` : 'No primary IBD medication.';
            const supplementsInfo = supplements.length > 0 ? `Supplements: ${supplements.map(formatCurrentMedication).join('; ')}` : 'No supplements.';

            const fullPrompt = `As a medical assistant for an IBD patient, summarize the following health data for their doctor. Focus specifically on **identifying and describing any observable patterns, trends, or correlations** between the patient's food intake, symptoms experienced, and bowel movements logged ${dateRangeText}. Also include current medications and supplements. Provide actionable insights or areas the doctor might want to investigate further based on these patterns.

            Patient ID: ${userId}

            Current Medications:
            ${medicationsInfo}
            ${supplementsInfo}

            Selected Health Logs (analyze these for patterns and insights):
            ${formattedLogs}
            
            Based on this information, provide a concise summary for the doctor in coherent paragraph form. Avoid using bullet points or lists in the main summary.`;

            // Call the Gemini API
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: fullPrompt }] });
            const payload = { contents: chatHistory };
            const apiKey = "" 
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const apiResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await apiResponse.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                setResponse(result.candidates[0].content.parts[0].text);
            } else {
                setMessage('Failed to generate response. Please try again.');
                console.error("Unexpected API response structure:", result);
            }
        } catch (error) {
            console.error("Error generating doctor report:", error);
            setMessage(`An error occurred: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isAuthReady) return <div className="text-center p-8 text-lg text-indigo-600 animate-pulse">Loading...</div>;

    return (
        <div className="space-y-6"> {/* Adjusted space-y */}
            <h2 className="text-xl font-bold text-indigo-700">Doctor Mode (AI Report Generation)</h2> {/* Adjusted text size */}
            <p className="text-sm text-gray-600">Select logs to include in the report for your doctor. The AI will summarize the data.</p> {/* Adjusted text size */}
            {message && <div className={`p-2 rounded-lg text-center text-sm ${message.includes('Failed') || message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{message}</div>} {/* Adjusted padding and text size */}

            <div className="bg-white p-3 rounded-lg shadow-md border"> {/* Adjusted padding */}
                <h3 className="text-base font-semibold text-indigo-700 mb-3">Choose Logs for Report</h3> {/* Adjusted text size and margin */}
                <button
                    onClick={handleSmartSelectLogs}
                    className="mb-3 px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg font-semibold hover:bg-purple-200 disabled:opacity-50 text-sm" // Adjusted padding and text size
                    disabled={logEntries.length === 0}
                >
                    Smart Select Recent Logs (Up to 14 Days)
                </button>
                {logEntries.length === 0 && <p className="text-gray-500 text-center mb-3 text-sm">No log entries available to select.</p>} {/* Adjusted margin and text size */}

                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1 mb-3"> {/* Adjusted max-height, padding, and space-y */}
                    {logEntries.map(entry => (
                        <div key={entry.id} className="flex items-center p-1.5 border-b last:border-b-0"> {/* Adjusted padding */}
                            <input
                                type="checkbox"
                                checked={selectedLogs.includes(entry.id)}
                                onChange={() => toggleLogSelection(entry.id)}
                                className="h-4 w-4 text-indigo-600 rounded"
                            />
                            <span className="ml-2 text-xs text-gray-700"> {/* Adjusted margin and text size */}
                                <strong className="text-indigo-600">{formatTimestamp(entry.timestamp)}</strong> - {entry.logType.toUpperCase()}:
                                {entry.logType === 'food' && ` ${formatFood(entry.food)}`}
                                {entry.logType === 'poop' && ` ${entry.poopType} (${fullBristolDescriptions[entry.poopType]})`}
                                {entry.logType === 'symptoms' && ` ${formatSymptoms(entry.symptoms)}`}
                            </span>
                        </div>
                    ))}
                </div>
                
                <button
                    onClick={generateReport}
                    disabled={isLoading || selectedLogs.length === 0}
                    className="w-full bg-indigo-600 text-white p-2.5 rounded-lg font-semibold text-base hover:bg-indigo-700 disabled:opacity-50" // Adjusted padding and text size
                >
                    {isLoading ? 'Generating Report...' : 'Generate Doctor Report'}
                </button>
            </div>

            {response && (
                <div className="bg-white p-3 rounded-lg shadow-md border mt-4"> {/* Adjusted padding and margin */}
                    <h3 className="text-base font-semibold text-indigo-700 mb-3">AI Generated Report Summary</h3> {/* Adjusted text size and margin */}
                    <div className="prose max-w-none">
                        {response.split('\n').map((paragraph, index) => (
                            <p key={index} className="mb-1.5 text-gray-800 leading-relaxed text-sm">{paragraph}</p>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const TravelModePage = () => {
    const { logEntries, mainIbdMed, supplements, userId, isAuthReady } = useContext(AppContext);
    const [travelPrompt, setTravelPrompt] = useState('');
    const [travelResponse, setTravelResponse] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');
    // Removed showPackingList state as it's no longer needed for a separate button flow

    // State for medication packing survey
    const [departureDate, setDepartureDate] = useState('');
    const [returnDate, setReturnDate] = useState('');
    const [destination, setDestination] = useState(''); // City, State/Province, Country
    const [currentTimezone, setCurrentTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone); // Default to user's local timezone
    const [destinationTimezone, setDestinationTimezone] = useState('');
    const [sleepStartHour, setSleepStartHour] = useState('22'); // 10 PM
    const [sleepEndHour, setSleepEndHour] = useState('07');   // 7 AM

    // Calculated doses (still needed to be passed to AI, even if not explicitly shown via another button)
    const [primaryMedNeeded, setPrimaryMedNeeded] = useState(0);
    const [supplementsNeeded, setSupplementsNeeded] = useState({});

    // Common timezones for dropdown, simplified list
    const commonTimezones = [
        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'America/Honolulu',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Dubai', 'Australia/Sydney', 'Pacific/Auckland',
        'Africa/Cairo', 'Africa/Lagos', 'Atlantic/Reykjavik', 'UTC'
    ].sort();

    // Function to calculate doses needed based on frequency and duration
    const calculateDosesNeeded = (frequency, durationDays) => {
        if (!frequency || !durationDays) return 0;
        let doses = 0;
        switch (frequency) {
            case 'Once daily':
                doses = durationDays;
                break;
            case 'Twice daily':
                doses = durationDays * 2;
                break;
            case 'Three times daily':
                doses = durationDays * 3;
                break;
            case 'Every other day':
                doses = Math.ceil(durationDays / 2);
                break;
            case 'Every three days':
                doses = Math.ceil(durationDays / 3);
                break;
            case 'Every four days':
                doses = Math.ceil(durationDays / 4);
                break;
            case 'Weekly':
                doses = Math.ceil(durationDays / 7);
                break;
            case 'Bi-weekly':
                doses = Math.ceil(durationDays / 14);
                break;
            case 'As needed':
            default:
                doses = 0; // "As needed" not calculated based on duration
        }
        return doses;
    };


    // Calculate meds needed based on travel dates
    useEffect(() => {
        if (departureDate && returnDate) {
            const dep = new Date(departureDate);
            const ret = new Date(returnDate);
            const diffTime = Math.abs(ret.getTime() - dep.getTime());
            const durationDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both departure and return day

            let calculatedPrimaryDoses = 0;
            if (mainIbdMed) {
                calculatedPrimaryDoses = calculateDosesNeeded(mainIbdMed.frequency, durationDays);
                
                // Add extra doses for main med
                let extraDoses = 0;
                if (durationDays < 14) { // Less than 2 weeks
                    extraDoses = 2;
                } else if (durationDays <= 30) { // 2 weeks to 1 month
                    extraDoses = 3;
                } else { // More than 1 month
                    extraDoses = 4;
                }
                calculatedPrimaryDoses += extraDoses;
            }
            setPrimaryMedNeeded(calculatedPrimaryDoses);

            const calculatedSupplements = {};
            supplements.forEach(sup => {
                calculatedSupplements[sup.name] = calculateDosesNeeded(sup.frequency, durationDays);
            });
            setSupplementsNeeded(calculatedSupplements);
        } else {
            setPrimaryMedNeeded(0);
            setSupplementsNeeded({});
        }
    }, [departureDate, returnDate, supplements, mainIbdMed]);

    // Removed handleCalculatePackingList

    const generateTravelAdvice = async () => {
        if (!userId) {
            setMessage("Please wait for user authentication to complete.");
            return;
        }
        // Only check required fields for enabling the button
        if (!departureDate || !returnDate || !destination || !currentTimezone || !destinationTimezone || !sleepStartHour || !sleepEndHour) {
            setMessage("Please fill out all required travel details (Dates, Destination, Timezones, Sleep Hours) before generating AI advice.");
            return;
        }
        
        // This check is fine to keep, but it's more of a warning than a strict blocker for the AI.
        if (mainIbdMed && (!mainIbdMed.frequency || mainIbdMed.medTimes.length === 0)) {
             setMessage("Warning: Primary medication missing frequency or specific times. Advice may be less accurate.");
             // Don't return, allow generation anyway
         }
        // Ensure sleep hours are valid numbers for parsing
        const parsedSleepStart = parseInt(sleepStartHour);
        const parsedSleepEnd = parseInt(sleepEndHour);

        if (isNaN(parsedSleepStart) || isNaN(parsedSleepEnd) || parsedSleepStart < 0 || parsedSleepStart > 23 || parsedSleepEnd < 0 || parsedSleepEnd > 23) {
            setMessage("Please enter valid sleep hours between 0 and 23.");
            return;
        }

        if (parsedSleepStart === parsedSleepEnd) { // User might mean 24 hours of sleep or a single moment
            setMessage("Sleep start and end hours cannot be the same. Please specify a duration for sleep.");
            return;
        }


        setIsLoading(true);
        setTravelResponse('');
        setMessage('');

        try {
            // Format recent logs (last 7 days for brevity in travel context)
            const recentLogs = logEntries.slice(0, 7).map(entry => {
                let details = '';
                if (entry.logType === 'food') {
                    details = `Food: ${formatFood(entry.food)}`;
                } else if (entry.logType === 'poop') {
                    details = `Poop Type: ${entry.poopType}`;
                } else if (entry.logType === 'symptoms') {
                    details = `Symptoms: ${formatSymptoms(entry.symptoms)}`;
                }
                return `Date: ${formatTimestamp(entry.timestamp)}, Type: ${entry.logType}, Details: ${details}`;
            }).join('\n');

            const medicationsInfo = mainIbdMed ? `Primary IBD Medication: ${formatCurrentMedication(mainIbdMed)}` : 'No primary IBD medication.';
            const supplementsInfo = supplements.length > 0 ? `Supplements: ${supplements.map(formatCurrentMedication).join('; ')}` : 'No supplements.';
            
            const primaryMedTimes = mainIbdMed?.medTimes ? mainIbdMed.medTimes.join(', ') : 'None specified';

            // Include calculated packing list info directly in the prompt
            const packingListInfo = `
            Medication Packing List (Calculated):
            Primary Medication Doses Needed: ${primaryMedNeeded}
            Supplements Doses Needed: ${JSON.stringify(supplementsNeeded)}
            `;


            // Shorter and more specific prompt for AI
            const fullPrompt = `Provide essential, concise travel advice for an IBD patient based on the following information.

            **Patient Profile:**
            - Primary Medication: ${medicationsInfo} (Current Times: ${primaryMedTimes} in ${currentTimezone})
            - Supplements: ${supplementsInfo}
            - Travel Dates: ${departureDate} to ${returnDate}
            - Destination: ${destination} (Timezone: ${destinationTimezone})
            - Sleep Hours (Destination Time): From ${sleepStartHour}:00 to ${sleepEndHour}:00

            **Recent Health Data (last 7 days):**
            ${recentLogs || "No recent logs available."}
            
            **Specific Travel Concerns:**
            ${travelPrompt || "None specified by the user. Provide general advice based on the above information."}
            
            **Instructions for AI (CONCISE RESPONSE REQUIRED):**
            1.  **Adjusted Medication Schedule:** Propose a primary medication schedule for the *destination timezone*, clearly showing how the times are adjusted to avoid the specified sleep hours (From ${sleepStartHour}:00 to ${sleepEndHour}:00}). If a time conflicts, suggest the nearest suitable alternative and explain why.
            2.  **Key IBD Packing Essentials:** List 3-5 critical items for an IBD patient's carry-on.
            3.  **Top 2 Travel Tips:** Provide 1-2 actionable, IBD-specific travel tips.
            4.  **Medication Packing Recommendation:** Based on travel duration, explicitly state the recommended doses to pack for the primary medication and any supplements.
            
            Maintain a brief, bullet-point or short paragraph format. Focus solely on essential IBD travel considerations.`;

            console.log("Sending prompt to AI:", fullPrompt); // Debugging: Log the full prompt
            console.log("Sleep Start Hour:", sleepStartHour, "Sleep End Hour:", sleepEndHour); // Debugging: Log sleep hours

            // Call the Gemini API
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: fullPrompt }] });
            const payload = { contents: chatHistory };
            const apiKey = "" 
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const apiResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // Added check for apiResponse.ok before parsing JSON
            if (!apiResponse.ok) {
                const errorText = await apiResponse.text(); 
                throw new Error(`API call failed with status ${apiResponse.status}: ${errorText}`);
            }

            const result = await apiResponse.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                setTravelResponse(result.candidates[0].content.parts[0].text);
            } else {
                setMessage('Failed to generate travel advice. Please try again.');
                console.error("Unexpected API response structure:", result);
            }
        } catch (error) {
            console.error("Error generating travel advice:", error);
            setMessage(`An error occurred: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isAuthReady) return <div className="text-center p-8 text-lg text-indigo-600 animate-pulse">Loading...</div>;

    return (
        <div className="space-y-6"> {/* Adjusted space-y */}
            <h2 className="text-xl font-bold text-indigo-700">Travel Mode (AI Travel Advice)</h2> {/* Adjusted text size */}
            <p className="text-sm text-gray-600">Get personalized travel advice based on your IBD history and medications.</p> {/* Adjusted text size */}
            {message && <div className={`p-2 rounded-lg text-center text-sm ${message.includes('Failed') || message.includes('Error') || message.includes('Warning') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{message}</div>} {/* Adjusted padding and text size */}

            <div className="bg-white p-3 rounded-lg shadow-md border"> {/* Adjusted padding */}
                <h3 className="text-base font-semibold text-indigo-700 mb-3">Travel Details for AI Advice</h3> {/* Adjusted text size and margin */}
                <div className="grid grid-cols-1 md:grid-cols-1 gap-3 mb-3"> {/* Adjusted grid, gap, and margin */}
                    <div>
                        <label htmlFor="departure-date" className="block text-xs font-medium text-gray-700">Departure Date:</label> {/* Adjusted text size */}
                        <input type="date" id="departure-date" value={departureDate} onChange={e => {setDepartureDate(e.target.value); setTravelResponse('');}} className="mt-1 block w-full p-2 border border-gray-300 rounded-md text-sm" /> {/* Adjusted padding and text size */}
                    </div>
                    <div>
                        <label htmlFor="return-date" className="block text-xs font-medium text-gray-700">Return Date:</label> {/* Adjusted text size */}
                        <input type="date" id="return-date" value={returnDate} onChange={e => {setReturnDate(e.target.value); setTravelResponse('');}} className="mt-1 block w-full p-2 border border-gray-300 rounded-md text-sm" /> {/* Adjusted padding and text size */}
                    </div>
                    <div className="col-span-1"> {/* Adjusted col-span */}
                        <label htmlFor="destination" className="block text-xs font-medium text-gray-700">Destination (City, State/Province, Country):</label> {/* Adjusted text size */}
                        <input type="text" id="destination" value={destination} onChange={e => {setDestination(e.target.value); setTravelResponse('');}} placeholder="e.g., Tokyo, Japan" className="mt-1 block w-full p-2 border border-gray-300 rounded-md text-sm" /> {/* Adjusted padding and text size */}
                    </div>
                    <div className="col-span-1 grid grid-cols-1 gap-3"> {/* Adjusted grid and gap */}
                        <div>
                            <label htmlFor="current-timezone" className="block text-xs font-medium text-gray-700">Your Current Timezone:</label> {/* Adjusted text size */}
                            <select id="current-timezone" value={currentTimezone} onChange={e => {setCurrentTimezone(e.target.value); setTravelResponse('');}} className="mt-1 block w-full p-2 border border-gray-300 rounded-md bg-white text-sm"> {/* Adjusted padding and text size */}
                                {commonTimezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="destination-timezone" className="block text-xs font-medium text-gray-700">Destination Timezone:</label> {/* Adjusted text size */}
                            <select id="destination-timezone" value={destinationTimezone} onChange={e => {setDestinationTimezone(e.target.value); setTravelResponse('');}} className="mt-1 block w-full p-2 border border-gray-300 rounded-md bg-white text-sm"> {/* Adjusted padding and text size */}
                                <option value="">Select a timezone</option>
                                {commonTimezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="col-span-1 grid grid-cols-2 gap-3"> {/* Adjusted grid and gap */}
                        <div>
                            <label htmlFor="sleep-start-hour" className="block text-xs font-medium text-gray-700">Sleep Start Hour (24h):</label> {/* Adjusted text size */}
                            <input type="number" id="sleep-start-hour" value={sleepStartHour} onChange={e => {setSleepStartHour(e.target.value); setTravelResponse('');}} min="0" max="23" className="mt-1 block w-full p-2 border border-gray-300 rounded-md text-sm" /> {/* Adjusted padding and text size */}
                        </div>
                        <div>
                            <label htmlFor="sleep-end-hour" className="block text-xs font-medium text-gray-700">Sleep End Hour (24h):</label> {/* Adjusted text size */}
                            <input type="number" id="sleep-end-hour" value={sleepEndHour} onChange={e => {setSleepEndHour(e.target.value); setTravelResponse('');}} min="0" max="23" className="mt-1 block w-full p-2 border border-gray-300 rounded-md text-sm" /> {/* Adjusted padding and text size */}
                        </div>
                    </div>
                </div>

                <label htmlFor="travel-prompt" className="block text-sm font-medium text-gray-700 mb-2">Tell me about your travel plans (optional):</label> {/* Adjusted text size and margin */}
                <textarea
                    id="travel-prompt"
                    className="w-full p-2 border border-gray-300 rounded-lg mb-3 resize-y text-sm" // Adjusted padding, margin, and text size
                    rows="3" // Adjusted rows
                    value={travelPrompt}
                    onChange={(e) => setTravelPrompt(e.target.value)}
                    placeholder="E.g., 'I'm flying to Japan next month, what should I be mindful of?', 'I'm going on a road trip, how can I manage diet?'"
                ></textarea>

                <button
                    onClick={generateTravelAdvice}
                    disabled={isLoading || !departureDate || !returnDate || !destination || !currentTimezone || !destinationTimezone || sleepStartHour === '' || sleepEndHour === ''}
                    className="w-full bg-indigo-600 text-white p-2.5 rounded-lg font-semibold text-base hover:bg-indigo-700 disabled:opacity-50" // Adjusted padding and text size
                >
                    {isLoading ? 'Generating Advice...' : 'Generate AI Travel Advice'}
                </button>
                <p className="text-red-500 text-xs mt-2 text-center">
                    Please fill out Departure Date, Return Date, Destination, Current Timezone, Destination Timezone, and Sleep Hours to generate advice.
                </p>
            </div>

            {travelResponse && (
                <div className="bg-white p-3 rounded-lg shadow-md border mt-4"> {/* Adjusted padding and margin */}
                    <h3 className="text-base font-semibold text-indigo-700 mb-3">AI Generated Travel Advice</h3> {/* Adjusted text size and margin */}
                    <div className="prose max-w-none">
                        {travelResponse.split('\n').map((paragraph, index) => (
                            <p key={index} className="mb-1.5 text-gray-800 leading-relaxed text-sm">{paragraph}</p>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const TriggerFoodsPage = () => {
    const { db, userId, isAuthReady, logEntries, appId } = useContext(AppContext);
    const [storedAnalysisSummary, setStoredAnalysisSummary] = useState('');
    const [storedYourTriggerFoods, setStoredYourTriggerFoods] = useState([]);
    const [storedPossibleTriggerFoods, setStoredPossibleTriggerFoods] = useState([]);
    const [storedAnalysisTimestamp, setStoredAnalysisTimestamp] = useState(null); // New state for the timestamp

    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');

    const analysisDocRef = useMemo(() => {
        if (!db || !userId) return null;
        return doc(db, `artifacts/${appId}/users/${userId}/ai_analysis/trigger_foods_latest`);
    }, [db, userId, appId]);


    useEffect(() => {
        if (!analysisDocRef || !isAuthReady) return;

        const unsubscribe = onSnapshot(analysisDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setStoredAnalysisSummary(data.summary || '');
                setStoredYourTriggerFoods(data.yourTriggerFoods || []);
                setStoredPossibleTriggerFoods(data.possibleTriggerFoods || []);
                setStoredAnalysisTimestamp(data.analysisTimestamp || null);
            } else {
                setStoredAnalysisSummary('');
                setStoredYourTriggerFoods([]);
                setStoredPossibleTriggerFoods([]);
                setStoredAnalysisTimestamp(null);
            }
        }, (error) => {
            console.error("Error fetching stored AI analysis:", error);
            setMessage("Failed to load previous analysis. Please try generating again.");
        });

        return () => unsubscribe();
    }, [analysisDocRef, isAuthReady]);


    const generateTriggerFoodAnalysis = async () => {
        if (!userId || !analysisDocRef) {
            setMessage("Please wait for user authentication to complete or database is not ready.");
            return;
        }

        setIsLoading(true);
        setMessage('');

        try {
            const foodLogs = logEntries.filter(entry => entry.logType === 'food');
            const symptomOrPoopLogs = logEntries.filter(entry => entry.logType === 'symptoms' || (entry.logType === 'poop' && (entry.poopType === 'Type 6' || entry.poopType === 'Type 7')));

            if (foodLogs.length === 0 || symptomOrPoopLogs.length === 0) {
                setMessage("Please log at least one food entry AND at least one symptom/liquid poop entry to perform an analysis.");
                setIsLoading(false);
                return;
            }

            const formattedLogs = logEntries.map(entry => { // Iterate over all log entries
                const base = {
                    id: entry.id,
                    timestamp: entry.timestamp,
                    logType: entry.logType,
                };
                if (entry.logType === 'food') {
                    return { ...base, food: entry.food.map(f => ({ name: f.name, quantity: f.quantity, measurement: f.measurement })) };
                } else if (entry.logType === 'symptoms') {
                    return { ...base, symptoms: Object.entries(entry.symptoms).filter(([,s]) => s.checked).map(([key,s]) => ({ name: key.replace(/([A-Z])/g, ' $1').trim().toLowerCase(), severity: s.severity })) };
                } else if (entry.logType === 'poop' && (entry.poopType === 'Type 6' || entry.poopType === 'Type 7')) {
                    // Treat Type 6/7 as a symptom for trigger food analysis
                    const symptomName = entry.poopType === 'Type 6' ? 'mushy stool' : 'liquid stool';
                    return { ...base, symptoms: [{ name: symptomName, severity: 10 }] }; // Assign high severity for these
                }
                return null;
            }).filter(Boolean); // Filter out nulls (other poop types, etc.)


            const currentAnalysisTimestamp = new Date().toISOString(); // Timestamp for the current analysis

            const fullPrompt = `Analyze the following health log data for an IBD patient to identify potential trigger foods. The data is a JSON array of log entries. Each 'food' entry details food consumed, and 'symptoms' entries detail symptoms experienced and their severity (including very loose/liquid stool as symptoms).

            Health Logs (JSON Array):
            ${JSON.stringify(formattedLogs, null, 2)}
            
            Based on this data, provide a structured JSON response with the following fields:
            - **summary**: A concise paragraph (aim for exactly five sentences) summarizing your general findings about potential trigger foods and overall confidence in a clean, narrative form. Avoid bullet points in this summary.
            - **yourTriggerFoods**: An array of objects, where each object has 'name' (string, e.g., "Dairy", "Gluten", "Spicy Food") and 'confidence' (number, 86-100) for foods you are highly confident are triggers.
            - **possibleTriggerFoods**: An array of objects, where each object has 'name' (string) and 'confidence' (number, 0-85) for foods that might be triggers but require more data or investigation.
            - **investigationStrategy**: A brief, actionable suggestion (1-2 sentences) for further investigation, such as an elimination diet.

            Ensure the response is a valid JSON object. Example structure:
            {
                "summary": "Based on the provided logs, there are some observable patterns...",
                "yourTriggerFoods": [{"name": "Dairy", "confidence": 92}],
                "possibleTriggerFoods": [{"name": "Spicy Food", "confidence": 75}],
                "investigationStrategy": "Consider an elimination diet for highly confident triggers."
            }`;

            // Set up generationConfig for structured JSON output
            const payload = {
                contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            "summary": { "type": "STRING" },
                            "yourTriggerFoods": {
                                "type": "ARRAY",
                                "items": {
                                    type: "OBJECT",
                                    properties: {
                                        "name": { "type": "STRING" },
                                        "confidence": { "type": "NUMBER" }
                                    },
                                    required: ["name", "confidence"]
                                }
                            },
                            "possibleTriggerFoods": {
                                "type": "ARRAY",
                                "items": {
                                    type: "OBJECT",
                                    properties: {
                                        "name": { "type": "STRING" },
                                        "confidence": { "type": "NUMBER" }
                                    },
                                    required: ["name", "confidence"]
                                }
                            },
                            "investigationStrategy": { "type": "STRING" }
                        },
                        required: ["summary", "yourTriggerFoods", "possibleTriggerFoods", "investigationStrategy"]
                    }
                }
            };
            
            const apiKey = "" 
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const apiResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!apiResponse.ok) {
                const errorText = await apiResponse.text();
                throw new Error(`API call failed with status ${apiResponse.status}: ${errorText}`);
            }

            const result = await apiResponse.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const jsonResponse = JSON.parse(result.candidates[0].content.parts[0].text);
                
                // Save the new analysis results to Firestore
                await setDoc(analysisDocRef, {
                    summary: jsonResponse.summary || '',
                    yourTriggerFoods: jsonResponse.yourTriggerFoods || [],
                    possibleTriggerFoods: jsonResponse.possibleTriggerFoods || [],
                    investigationStrategy: jsonResponse.investigationStrategy || '',
                    analysisTimestamp: currentAnalysisTimestamp // Store the timestamp
                }, { merge: true });

            } else {
                setMessage('Failed to generate analysis. Please try again.');
                console.error("Unexpected API response structure or missing content:", result);
            }
        } catch (error) {
            console.error("Error generating trigger food analysis:", error);
            setMessage(`An error occurred: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isAuthReady) return <div className="text-center p-8 text-lg text-indigo-600 animate-pulse">Loading...</div>;

    const hasFoodLogs = logEntries.filter(e => e.logType === 'food').length > 0;
    const hasSymptomOrPoopLogs = logEntries.filter(e => e.logType === 'symptoms' || (e.logType === 'poop' && (e.poopType === 'Type 6' || e.poopType === 'Type 7'))).length > 0;

    return (
        <div className="space-y-6"> {/* Adjusted space-y */}
            <h2 className="text-xl font-bold text-indigo-700">Trigger Foods (AI Analysis)</h2> {/* Adjusted text size */}
            <p className="text-sm text-gray-600">Let the AI analyze your food and symptom logs to help identify potential trigger foods.</p> {/* Adjusted text size */}
            {message && <div className={`p-2 rounded-lg text-center text-sm ${message.includes('Failed') || message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{message}</div>} {/* Adjusted padding and text size */}

            <div className="bg-white p-3 rounded-lg shadow-md border"> {/* Adjusted padding */}
                <button
                    onClick={generateTriggerFoodAnalysis}
                    // Button enabled if at least one food log AND at least one symptom/poop log (type 6/7) exists
                    disabled={isLoading || !(hasFoodLogs && hasSymptomOrPoopLogs)}
                    className="w-full bg-indigo-600 text-white p-2.5 rounded-lg font-semibold text-base hover:bg-indigo-700 disabled:opacity-50" // Adjusted padding and text size
                >
                    {isLoading ? 'Analyzing...' : 'Analyze Trigger Foods'}
                </button>
                {!(hasFoodLogs && hasSymptomOrPoopLogs) && (
                     <p className="text-red-500 text-center mt-2 text-xs">Please log at least one food entry AND one symptom/liquid stool entry to enable this feature.</p>
                )}
            </div>

            {(storedYourTriggerFoods.length > 0 || storedPossibleTriggerFoods.length > 0 || storedAnalysisSummary) && (
                <div className="bg-white p-3 rounded-lg shadow-md border mt-4"> {/* Adjusted padding and margin */}
                    {storedYourTriggerFoods.length > 0 && (
                        <div className="mb-3"> {/* Adjusted margin */}
                            <h3 className="text-base font-semibold text-red-700 mb-2">Your Trigger Foods (Highly Confident)</h3> {/* Adjusted text size and margin */}
                            <ul className="list-disc list-inside text-gray-800 text-sm"> {/* Adjusted text size */}
                                {storedYourTriggerFoods.map((food, index) => (
                                    <li key={index}>{food.name} (Confidence: {food.confidence}%)</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    
                    {storedPossibleTriggerFoods.length > 0 && (
                        <div className="mb-3"> {/* Adjusted margin */}
                            <h3 className="text-base font-semibold text-orange-700 mb-2">Possible Trigger Foods (Needs More Data)</h3> {/* Adjusted text size and margin */}
                            <ul className="list-disc list-inside text-gray-800 text-sm"> {/* Adjusted text size */}
                                {storedPossibleTriggerFoods.map((food, index) => (
                                    <li key={index}>{food.name} (Confidence: {food.confidence}%)</li>
                                ))}
                            </ul>
                            {storedAnalysisTimestamp && (
                                <p className="text-xs text-gray-500 mt-2">
                                    Last analyzed on: {new Date(storedAnalysisTimestamp).toLocaleDateString()}
                                </p>
                            )}
                        </div>
                    )}
                    
                    {storedAnalysisSummary && (
                        <div>
                            <h3 className="text-base font-semibold text-indigo-700 mb-3">AI Generated Analysis Summary</h3> {/* Adjusted text size and margin */}
                            <div className="prose max-w-none">
                                <p key={"analysis-summary"} className="mb-1.5 text-gray-800 leading-relaxed text-sm">{storedAnalysisSummary}</p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default App;
