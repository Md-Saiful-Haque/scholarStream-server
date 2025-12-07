const express = require('express')
const cors = require('cors')
const app = express()
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config()

const port = process.env.PORT || 3000


app.use(express.json())
app.use(
    cors({
        origin: [
            'http://localhost:5173',
            'http://localhost:5174'
        ],
        credentials: true,
        optionSuccessStatus: 200,
    })
)

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nmodl3i.mongodb.net/?appName=Cluster0`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        const db = client.db('scholarStreamDB')
        const usersCollection = db.collection('users')
        const scholarshipsCollection = db.collection('scholarships')
        const applicationsCollection = db.collection('applications')
        const reviewsCollection = db.collection('reviews')

        // users related apis
        app.post('/users', async (req, res) => {
            const userInfo = req.body;
            userInfo.role = 'Student';
            userInfo.createdAt = new Date()
            const email = userInfo.email
            const userExists = await usersCollection.findOne({ email })
            if (userExists) {
                return res.send({ message: 'user already exists' })
            }

            const result = await usersCollection.insertOne(userInfo)
            res.send(result)
        })

        // scholarship related apis
        app.get('/scholarship', async (req, res) => {
            const result = await scholarshipsCollection.find().toArray()
            res.send(result)
        })
        
        app.get('/latest-scholarship', async (req, res) => {
            const cursor = scholarshipsCollection.find().sort({ createdAt: -1 }).limit(6)
            const result = await cursor.toArray()
            res.send(result)
        })

        app.post('/add-scholarship', async (req, res) => {
            const data = req.body
            data.createdAt = new Date()
            const result = await scholarshipsCollection.insertOne(data)
            res.send(result)
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        //await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello from Scholar Stream Server..')
})

app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
})