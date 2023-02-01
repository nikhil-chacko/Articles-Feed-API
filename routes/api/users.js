const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { check, validationResult } = require("express-validator");
const checkObjectId = require("../../middleware/checkObjectId");
const bcrypt = require("bcryptjs");

const User = require("../../models/User");
const schedule = require("../../jobs/scheduler");

//middleware
const auth = require("../../middleware/auth");

//@route POST api/users
//@desc Register a new User
//@acess Public
router.post(
  "/",
  [
    check("firstname", "Please Enter a First Name").not().isEmpty(),
    check("lastname", "Please Enter a Last Name").not().isEmpty(),
    check("email", "Please include a valid email").isEmail(),
    check("phone", "Please Enter a valid phone number").isNumeric(),
    check("date_of_birth", "Please Enter a valid date of birth")
      .not()
      .isEmpty(),
    check("article_preferences", "Please Enter one or two preferences")
      .not()
      .isEmpty(),
    check("password", "Password must be atleast 6 characters long").isLength({
      min: 6,
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(errors);
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      firstname,
      lastname,
      email,
      phone,
      date_of_birth,
      article_preferences,
      password,
    } = req.body;
    try {
      //See if the user exists

      let userEmail = await User.findOne({ email });

      if (userEmail) {
        return res
          .status(400)
          .json({ errors: [{ msg: "User with this email already exists" }] });
      }

      let userPhone = await User.findOne({ phone });

      if (userPhone) {
        return res.status(400).json({
          errors: [{ msg: "User with this phone number already exists" }],
        });
      }

      const current_time = new Date();
      const otp_expiry = current_time.setMinutes(
        current_time.getMinutes() + 30
      );
      const otp = Math.floor(Math.random() * 1000000);

      let user = new User({
        firstname,
        lastname,
        email,
        phone,
        date_of_birth,
        article_preferences,
        password,
        otp: otp,
        is_verified: false,
        otp_expiry: otp_expiry,
      });

      //Encrypt password
      const salt = await bcrypt.genSalt(10);

      user.password = await bcrypt.hash(password, salt);

      const user_created = await user.save();

      const verifyUrl = `${process.env.FRONTEND_URL}/verify-account/${user_created.uuid}/${otp}`;

      //Send OTP to user's email
      const mailOptions = {
        from: "devinfoster1210@gmail.com",
        to: email,
        subject: "Verify your account",
        text: `Welcome to Articles Feed to create articles you need to verify your account\n\n
      Please click on the following link, or paste this into your browser to complete the process:\n\n
      ${verifyUrl}\n\n
      or paste the following otp in settings page ${otp}\n`,
      };

      //Send mail
      await schedule.sendOtp(mailOptions);

      //Return JWT
      const payload = {
        user: {
          id: user.id,
        },
      };
      const jwtsecret = process.env.JWT_SECRET;
      jwt.sign(payload, jwtsecret, { expiresIn: 360000 }, (err, token) => {
        if (err) throw err;
        res.json({ token });
      });
      //Catching Error
    } catch (error) {
      console.log(error.message);
      res.status(500).send("Internal Server Error");
    }
  }
);

//@route POST api/users/edit
//@desc Edit a User
//@acess Private
router.put(
  "/edit",
  [
    auth,
    [
      check("firstname", "Please Enter a First Name").not().isEmpty(),
      check("lastname", "Please Enter a Last Name").not().isEmpty(),
      check("email", "Please include a valid email").isEmail(),
      check("phone", "Please Enter a valid phone number").isNumeric(),
      check("date_of_birth", "Please Enter a valid date of birth")
        .not()
        .isEmpty(),
      check("article_preferences", "Please Enter one or two preferences")
        .not()
        .isEmpty(),
    ],
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(errors);
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      firstname,
      lastname,
      email,
      phone,
      date_of_birth,
      article_preferences,
      password,
    } = req.body;
    try {
      //See if the user exists

      if (password && password.length < 6) {
        return res.status(400).json({
          errors: [{ msg: "Password must be atleast 6 characters long" }],
        });
      }

      let user = await User.findById(req.user.id);

      if (!user) {
        return res
          .status(400)
          .json({ errors: [{ msg: "User does not exist" }] });
      }

      user.firstname = firstname;
      user.lastname = lastname;
      user.email = email;
      user.phone = phone;
      user.date_of_birth = date_of_birth;
      user.article_preferences = article_preferences;

      if (password && password.length) {
        //Encrypt password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
      }

      const updated_user = await user.save();

      return res.json({
        firstname: updated_user.firstname,
        lastname: updated_user.lastname,
        email: updated_user.email,
        phone: updated_user.phone,
        date_of_birth: updated_user.date_of_birth,
        article_preferences: updated_user.article_preferences,
        is_verified: updated_user.is_verified,
      });
      //Catching Error
    } catch (error) {
      console.log(error);
      res.status(500).send("Internal Server Error");
    }
  }
);

//@route POST api/users/verify
//@desc Verify a User
//@acess Private
router.post(
  "/verify-otp",
  [auth, [check("otp", "Please Enter a valid OTP").not().isEmpty()]],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(errors);
      return res.status(400).json({ errors: errors.array() });
    }

    const { otp } = req.body;
    try {
      //See if the user exists
      const user = await User.findById(req.user.id);

      if (user) {
        if (user.otp === parseInt(otp)) {
          if (user.otp_expiry > Date.now()) {
            user.is_verified = true;
            user.otp = null;
            await user.save();
            return res.json({
              is_verified: true,
            });
          } else {
            return res
              .status(400)
              .json({ errors: [{ msg: "OTP has expired" }] });
          }
        } else {
          return res.status(400).json({
            errors: [{ msg: "OTP does not match" }],
          });
        }
      } else {
        return res.status(400).json({
          errors: [{ msg: "User does not exist" }],
        });
      }
      //Catching Error
    } catch (error) {
      console.log(error);
      res.status(500).send("Internal Server Error");
    }
  }
);

router.get("/resend-otp", [auth], async (req, res) => {
  try {
    //See if the user exists
    const user = await User.findById(req.user.id);
    const current_time = new Date();
    const otp_expiry = current_time.setMinutes(current_time.getMinutes() + 30);
    const otp = Math.floor(Math.random() * 1000000);

    user.otp = otp;
    user.otp_expiry = otp_expiry;
    await user.save();
    //Send OTP to user's email
    const mailOptions = {
      from: "devinfoster1210@gmail.com",
      to: user.email,
      subject: "Verify your account",
      text: `Welcome to the Articles Feed. Your OTP is ${otp}`,
    };

    //Send mail
    await schedule.sendOtp(mailOptions);

    return res.json({
      message: "OTP sent to your email",
    });

    //Catching Error
  } catch (error) {
    console.log(error);
    res.status(500).send("Internal Server Error");
  }
});

// @route    PUT api/users/follow/:id
// @desc     Follow a user
// @access   Private
router.put("/follow/:id", [auth, checkObjectId], async (req, res) => {
  try {
    const followingUser = await User.findById(req.user.id);
    const followedUser = await User.findById(req.params.id);

    // Check if user is not the same user that sent the request
    if (req.params.id === req.user.id) {
      return res
        .status(400)
        .json({ errors: [{ msg: "Can't follow yourself!" }] });
    }

    // Check and remove following user from Req User's list if already followed
    if (
      followingUser.following.some(
        (iterator) => iterator.user.toString() === req.params.id
      )
    ) {
      followingUser.following = followingUser.following.filter(
        ({ user }) => user.toString() !== req.params.id
      );

      await followingUser.save();

      // Remove follower from Param User's list if already following
      followedUser.followers = followedUser.followers.filter(
        ({ user }) => user.toString() !== req.user.id
      );

      await followedUser.save();

      return res.json(followingUser);
    }

    // Else Update following and followed lists
    if (followingUser && followedUser) {
      //Save the new like
      followingUser.following.unshift({ user: req.params.id });
      followedUser.followers.unshift({ user: req.user.id });

      await followingUser.save();
      await followedUser.save();

      return res.json(followingUser);
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    // See if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ errors: [{ msg: "User does not exist" }] });
    }
    const current_time = new Date();
    const otp_expiry = current_time.setMinutes(current_time.getMinutes() + 10);
    const otp = Math.floor(Math.random() * 1000000);
    const user_uuid = uuidv4();

    user.password_otp = otp;
    user.password_otp_expiry = otp_expiry;
    user.password_uuid = user_uuid;
    await user.save();

    // Send the email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${user_uuid}/${otp}`;

    const mailOptions = {
      from: "devinfoster1210@gmail.com",
      to: user.email,
      subject: "Reset Password",
      text: `You are receiving this email because you (or someone else) have requested the reset of the password for your account.\n\n
      Please click on the following link, or paste this into your browser to complete the process:\n\n
      ${resetUrl}\n\n
      If you did not request this, please ignore this email and your password will remain unchanged.\n`,
    };

    await schedule.sendForgotPasswordMail(mailOptions);

    res.json({ msg: "Email sent" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

router.post("/reset-password/:password_uuid/:otp", async (req, res) => {
  try {
    const { password, confirm_password } = req.body;
    const { password_uuid, otp } = req.params;

    // See if user exists
    const user = await User.findOne({ password_uuid });
    if (!user) {
      return res
        .status(400)
        .json({ errors: [{ msg: "Something seems wrong with you" }] });
    }

    // Check if OTP is valid
    const current_time = new Date();
    if (current_time > user.password_otp_expiry) {
      return res.status(400).json({ errors: [{ msg: "Link has expired" }] });
    }

    if (user.password_otp !== parseInt(otp)) {
      return res.status(400).json({ errors: [{ msg: "Link is incorrect" }] });
    }

    // Check if passwords match
    if (password !== confirm_password) {
      return res
        .status(400)
        .json({ errors: [{ msg: "Passwords do not match" }] });
    }

    const salt = await bcrypt.genSalt(10);
    // Update user password
    user.password = await bcrypt.hash(password, salt);
    user.password_otp = null;
    user.password_otp_expiry = null;
    user.password_uuid = null;
    await user.save();

    //Return JWT
    const payload = {
      user: {
        id: user.id,
      },
    };
    const jwtsecret = process.env.JWT_SECRET;
    jwt.sign(payload, jwtsecret, { expiresIn: 360000 }, (err, token) => {
      if (err) throw err;
      res.json({ token });
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

module.exports = router;
