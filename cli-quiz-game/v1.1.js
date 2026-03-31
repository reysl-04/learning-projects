// Don't over-engineer the project. A simple file is ok

/* 
Steps:

[X] - Call the API
[X] - Ask user for response
[x] - keep track of score
[X] - Fortmat game
 
 */

// Import module to get user input
import readline from "readline";
// Package to decode html (used to correctly format questions)
import he from "he";

// You need to declare the interface first
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})
// Async function (returns a promise) asking for an input
function askQuestion(question) {
    return new Promise(resolve => {
        rl.question(question, ans => {
            resolve(ans);
        });
    });
}


// ------------------------------------------------------------------------------------

// Async function to get data from API
async function getData() {
    // Defined API key
    const API = "https://opentdb.com/api.php?amount=10";
    // use fetch to get a promise
    try {
    const response = await fetch(API); // What if URL does not exist? The following thing happens: Failed to parse URL from hello
    // throws an error if failed to fetch API
    if (!response.ok) {
        throw new Error(`Failed to access data. Response Status: ${response.status}`);
    }

    const data = await response.json();
    return data.results

    } catch (e) {
        console.error(e.message);
    }
}

// For some reason, I can use await in a promise without being inside an async functiom
// const data = await getData();
// console.log(data)

// ------------------------------------------------------------------------------------

// Main function that runs the game
async function main() {
    try {
        const data = await getData();
        console.log(data[0]);
        // Track Score 
        let score = 0;
        const qNumber = data.length

        for (const question of data) {
            // Question details
            console.log(`\nDifficulty: ${question.difficulty[0].toUpperCase() + question.difficulty.slice(1)} | Type: ${question.type[0].toUpperCase() + question.type.slice(1)} question`);
            console.log(`Category: ${he.decode(question.category)}`)
            console.log(`Current Scode: ${score}/${qNumber}\n`)

            // ask question with readline interface
            // he.decode handles the &alt###; signs in the data
            const formatted_q = he.decode(question.question);
            console.log(`Question: ${formatted_q}`)
            
            const correctAnswer = he.decode(question.correct_answer);
            // stores user's response
            
            const options = question.incorrect_answers.map(option => {return he.decode(option)})
            options.push(correctAnswer);
            // What about long answers? The user is gonna be annoyed. I can use an object data structure to store the results, 
            // so the user can simply write the number
            console.log(`\nOptions:`);
            options.forEach((option, i) => console.log(`${i + 1}. ${option}`))
            console.log("\nAnswer:")
            const ans = await askQuestion("");

            // Decides if answer is correct 
            if (ans.toLowerCase() == correctAnswer.toLowerCase()) {
                score ++;
                console.log(`Correct!`);
            } else {
                console.log(`Incorrect!`);
            }
        }

        console.log(`Your final score is ${score}/${qNumber}`);
        rl.close()
    } catch (e) {
        return null
    }
}

main();