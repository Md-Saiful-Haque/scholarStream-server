require('dotenv').config()
const express = require('express')
const cors = require('cors')
const app = express()

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const admin = require("firebase-admin");

const port = process.env.PORT || 3000

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
    'utf-8'
)
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



app.use(express.json())
app.use(
    cors({
        origin: [
            'http://localhost:5173',
            'http://localhost:5174',
            'https://scholar-stream-da98b.web.app'
        ],
        credentials: true,
        optionSuccessStatus: 200,
    })
)

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nmodl3i.mongodb.net/?appName=Cluster0`;

// jwt middlewares
const verifyJWT = async (req, res, next) => {
    const token = req?.headers?.authorization?.split(' ')[1]
    console.log(token)
    if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.tokenEmail = decoded.email
        console.log(decoded)
        next()
    } catch (err) {
        console.log(err)
        return res.status(401).send({ message: 'Unauthorized Access!', err })
    }
}

//{ email: { $ne: adminEmail } }
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        //await client.connect();

        const db = client.db('scholarStreamDB')
        const usersCollection = db.collection('users')
        const scholarshipsCollection = db.collection('scholarships')
        const applicationsCollection = db.collection('applications')
        const reviewsCollection = db.collection('reviews')

        // middleware with database access
        const verifyAdmin = async (req, res, next) => {
            const email = req.tokenEmail
            const query = { email };
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'Admin') {
                res.status(403).send({ message: 'forbidden access' })
            }
            next()
        }

        const verifyModerator = async (req, res, next) => {
            const email = req.tokenEmail
            const query = { email };
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'Moderator') {
                res.status(403).send({ message: 'forbidden access' })
            }
            next()
        }

        // users related apis
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const adminEmail = req.tokenEmail;
            const result = await usersCollection.find().toArray()
            res.send(result)
        })

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

        // get user's role
        app.get('/users/:email/role', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const result = await usersCollection.findOne(query)
            res.send({ role: result?.role })
        })

        app.delete('/delete-user/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await usersCollection.deleteOne(query)
            res.send(result)
        })

        // update application role by admin
        app.patch('/update-role/:id', async (req, res) => {
            const { role } = req.body;
            const result = await usersCollection.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { role: role } }
            );

            res.send(result);
        });

        // scholarship related apis
        app.get('/scholarship', async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = 6;
            const skip = (page - 1) * limit;
            const country = req.query.country;
            const sort = req.query.sort;
            const search = req.query.search
            const query = search
                ? {
                    $or: [
                        { scholarshipName: { $regex: search, $options: "i" } },
                        { universityName: { $regex: search, $options: "i" } },
                        { degree: { $regex: search, $options: "i" } }
                    ]
                }
                : {};

            if (country) {
                query.country = country;
            }

            let sortOption = {};
            if (sort === "fees_desc") {
                sortOption = { applicationFees: -1 };
            } else if (sort === "fees_asc") {
                sortOption = { applicationFees: 1 };
            } else if (sort === "date_desc") {
                sortOption = { postDate: -1 };
            }

            const total = await scholarshipsCollection.countDocuments(query);

            const result = await scholarshipsCollection.find(query).sort(sortOption).skip(skip).limit(limit).toArray()

            res.send({ result, total })
        })

        app.get('/latest-scholarship', async (req, res) => {
            const cursor = scholarshipsCollection.find().sort({ createdAt: -1 }).limit(6)
            const result = await cursor.toArray()
            res.send(result)
        })

        app.get('/scholarship/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await scholarshipsCollection.findOne(query)
            res.send(result)
        })

        app.post('/add-scholarship', verifyJWT, verifyAdmin, async (req, res) => {
            const data = req.body
            data.createdAt = new Date()
            const result = await scholarshipsCollection.insertOne(data)
            res.send(result)
        })

        app.get('/manage-scholarship', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await scholarshipsCollection.find().toArray()
            res.send(result)
        })

        app.put('/update-scholarship/:id', async (req, res) => {
            const id = req.params.id
            const data = req.body
            delete data._id
            const query = { _id: new ObjectId(id) }
            const update = {
                $set: { ...data }
            }
            const result = await scholarshipsCollection.updateOne(query, update)
            res.send(result)
        })

        app.delete('/delete-scholarship/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await scholarshipsCollection.deleteOne(query)
            res.send(result)
        })

        // payment by stripe
        app.post('/create-checkout-session', async (req, res) => {
            const applicantInfo = req.body;

            const alreadyApplied = await applicationsCollection.findOne({
                scholarshipId: applicantInfo.scholarshipId,
                userEmail: applicantInfo.userEmail,
                paymentStatus: "paid"
            });

            if (alreadyApplied) {
                return res.status(409).send({
                    message: "❌ You already applied for this scholarship!"
                });
            }

            //await applicationsCollection.insertOne({ ...applicantInfo, paymentStatus: "unpaid" })

            const unpaid = await applicationsCollection.findOne({
                scholarshipId: applicantInfo.scholarshipId,
                userEmail: applicantInfo.userEmail,
                paymentStatus: "unpaid"
            });

            if (!unpaid) {
                await applicationsCollection.insertOne(applicantInfo);
            }

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'USD',
                            unit_amount: parseInt(applicantInfo.applicationFees) * 100,
                            product_data: {
                                name: applicantInfo.universityName,
                                description: applicantInfo.scholarshipName,
                                images: [applicantInfo.image]
                            }
                        },
                        quantity: 1
                    },
                ],
                customer_email: applicantInfo.userEmail,
                mode: 'payment',
                metadata: {
                    scholarshipId: applicantInfo.scholarshipId,
                    customer: applicantInfo.userEmail,
                    scholarshipName: applicantInfo.scholarshipName,
                    universityName: applicantInfo.universityName
                },
                success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.CLIENT_DOMAIN}/payment-failed/${applicantInfo._id}`,
            })
            res.send({ url: session.url })
        })

        app.post('/payment-success', async (req, res) => {

            const { sessionId } = req.body;

            const session = await stripe.checkout.sessions.retrieve(sessionId);


            if (session.payment_status !== "paid") {
                return res.send({ success: false });
            }

            const alreadyExist = await applicationsCollection.findOne({
                transactionId: session.payment_intent
            });

            if (alreadyExist) {
                return res.send({ message: "Already Exist" });
            }

            await applicationsCollection.updateOne(
                {
                    scholarshipId: session.metadata.scholarshipId,
                    userEmail: session.metadata.customer,
                    paymentStatus: "unpaid"
                },
                {
                    $set: {
                        paymentStatus: "paid",
                        transactionId: session.payment_intent,
                        paidAmount: session.amount_total / 100
                    }
                }
            );

            res.send({
                success: true,
                data: {
                    transactionId: session.payment_intent,
                    sessionId,
                    scholarshipName: session.metadata.scholarshipName,
                    universityName: session.metadata.universityName,
                    paidAmount: session.amount_total / 100
                }

            });
        });

        app.get('/admin/analytics', verifyJWT, verifyAdmin, async (req, res) => {
            const totalUsers = await usersCollection.countDocuments();
            const totalScholarships = await scholarshipsCollection.countDocuments();
            const pipeline = [
                {
                    $group: {
                        _id: 'applicationFees',
                        count: {
                            $sum: '$applicationFees'
                        }
                    }
                }
            ]
            const result = await applicationsCollection.aggregate(pipeline).toArray()
            res.send({
                totalUsers,
                totalScholarships,
                result
            })
        })


        app.get('/admin/applications-chart', async (req, res) => {
            const result = await applicationsCollection.aggregate([
                {
                    $group: {
                        _id: "$universityName",
                        count: { $sum: 1 }
                    }
                }
            ]).toArray();

            res.send(result);
        });

        // get my applications
        app.get('/my-applications/:email', async (req, res) => {
            const email = req.params.email;
            const result = await applicationsCollection.find({ userEmail: email }).toArray()
            res.send(result)
        })

        app.get('/payment-failed/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await applicationsCollection.findOne(query)
            res.send(result)
        })

        // get all aplication for modaretor
        app.get('/all-applications', verifyJWT, verifyModerator, async (req, res) => {
            const result = await applicationsCollection.find().toArray()
            res.send(result)
        })

        // update feedback by modaretor
        app.patch("/applications/feedback/:id", verifyJWT, verifyModerator, async (req, res) => {
            const { feedback } = req.body;

            const result = await applicationsCollection.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { feedback } }
            );

            res.send(result);
        });

        // update application status by modaretor
        app.patch('/update-status/:id', verifyJWT, verifyModerator, async (req, res) => {
            const { status } = req.body;
            const result = await applicationsCollection.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { applicationStatus: status } }
            );

            res.send(result);
        });

        // cancel application by modaretor
        app.patch('/rejected-application/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await applicationsCollection.updateOne(query, { $set: { applicationStatus: 'rejected' } })
            res.send(result)
        })

        // add reviews
        app.post('/add-reviews', async (req, res) => {
            const reviewInfo = req.body;
            reviewInfo.createdAt = new Date();
            const result = await reviewsCollection.insertOne(reviewInfo);
            res.send(result)
        })

        app.get('/my-reviews/:email', async (req, res) => {
            const email = req.params.email;
            const result = await reviewsCollection.find({ userEmail: email }).toArray()
            res.send(result)
        })

        // update my review
        app.patch('/update-reviews/:id', async (req, res) => {
            const id = req.params.id;
            const { ratingPoint, reviewComment } = req.body;

            const result = await reviewsCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        ratingPoint,
                        reviewComment
                    },
                }
            );

            res.send(result);
        });

        // get all reviews
        app.get('/all-reviews', verifyJWT, verifyModerator, async (req, res) => {
            const result = await reviewsCollection.find().toArray()
            res.send(result)
        })

        // get review to show scholarship details page
        app.get('/reviews/:id', async (req, res) => {
            const id = req.params.id;
            const result = await reviewsCollection.find({ scholarshipId: id }).toArray()
            res.send(result)
        })

        app.delete('/delete-myReview/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await reviewsCollection.deleteOne(query)
            res.send(result)
        })

        app.delete('/delete-review/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await reviewsCollection.deleteOne(query)
            res.send(result)
        })




        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
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