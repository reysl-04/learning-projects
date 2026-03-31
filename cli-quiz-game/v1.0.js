import readline from "readline"

// async function to get data from API
async function main() {
    const API = "https://opentdb.com/api.php?amount=10";
    // Error handling
    try {
        // fetch response from api
        const response = await fetch(API);
        // fetch will always return a promise
        // If promise status is fail
        if (!(response.ok)) {
            throw new Error(`There was an error. Result status ${response.status}`);
        }

        // getting the result 
        const result = await response.json();

    } catch(error) {
        console.error(error.message)
    }
}

const data = await main();
console.log(data);

/*
Data Type: Object 
Content:
    response_node: 0,
    results (array of objects): [
        <----- Syntax of each object ---->
        type: 'boolean' / 'multiple'
        difficulty: 'easy' / 'medium' / 'hard'
        category: string
        question: string
        correct_answer: 'bool' / 'string'
        incorrect_answers: [Array]
    ]
*/