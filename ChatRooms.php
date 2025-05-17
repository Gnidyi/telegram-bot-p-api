<?php 
	
class ChatRooms
{
	private $chat_id;
	private $user_id;
	private $message;
	private $created_on;
	private $connect;

	public function setChatId($chat_id)
	{
		$this->chat_id = $chat_id;
	}

	function getChatId()
	{
		return $this->chat_id;
	}

	function setUserId($user_id)
	{
		$this->user_id = $user_id;
	}

	function getUserId()
	{
		return $this->user_id;
	}

	function setMessage($message)
	{
		$this->message = $message;
	}

	function getMessage()
	{
		return $this->message;
	}

	function setCreatedOn($created_on)
	{
		$this->created_on = $created_on;
	}

	function getCreatedOn()
	{
		return $this->created_on;
	}

    public function getConnection() {
        return $this->connect;
    }

	public function __construct()
	{
		require_once("Database_connection.php");

		$database_object = new Database_connection;

		$this->connect = $database_object->connect();
	}

	function save_chat()
	{
        error_log("save_chat() was called with message: " . $this->message);
		$query = "
		INSERT INTO chatrooms 
			(userid, msg, created_on) 
			VALUES (:userid, :msg, :created_on)
		";

		$statement = $this->connect->prepare($query);

		$statement->bindParam(':userid', $this->user_id);

		$statement->bindParam(':msg', $this->message);

		$statement->bindParam(':created_on', $this->created_on);

		$statement->execute();
	}

	function get_all_chat_data()
	{
		$query = "
		SELECT * FROM chatrooms 
			INNER JOIN chat_user_table 
			ON chat_user_table.user_id = chatrooms.userid 
			ORDER BY chatrooms.id ASC
		";

		$statement = $this->connect->prepare($query);

		$statement->execute();

		return $statement->fetchAll(PDO::FETCH_ASSOC);
	}

    function getEnvVar($key) {
        if (!file_exists(__DIR__ . '/.env')) {
            return null;
        }

        $lines = file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            list($envKey, $envValue) = explode('=', $line, 2);
            if (trim($envKey) === $key) {
                return trim($envValue);
            }
        }

        return null;
    }

    public function is_toxic($message) {
        $apiKey = $this->getEnvVar('API_KEY');
        $url = "https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=" . $apiKey;

        $data = [
            'comment' => ['text' => $message],
            'languages' => ['en'],
            'requestedAttributes' => ['TOXICITY' => new stdClass()]
        ];

        $options = [
            'http' => [
                'header'  => "Content-type: application/json\r\n",
                'method'  => 'POST',
                'content' => json_encode($data)
            ]
        ];
        $context  = stream_context_create($options);
        $result = file_get_contents($url, false, $context);

        error_log("is_toxic result: " . print_r($result, true));  // Логуємо відповідь API

        if ($result === FALSE) {
            return false;
        }

        $response = json_decode($result, true);
        $toxicityScore = $response['attributeScores']['TOXICITY']['summaryScore']['value'] ?? 0;

        error_log("Toxicity score: " . $toxicityScore);  // Логуємо оцінку токсичності

        return $toxicityScore >= 0.7;
    }

    public function insert_message($user_id, $message) {
        error_log("insert_message() was called with message: " . $message);
        $query = "SELECT violations, ban_until FROM user_bans WHERE user_id = :user_id";
        $stmt = $this->connect->prepare($query);
        $stmt->execute(['user_id' => $user_id]);
        $banInfo = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($banInfo) {
            $currentTime = new DateTime();
            $banUntil = $banInfo['ban_until'] ? new DateTime($banInfo['ban_until']) : null;

            if ($banUntil && $currentTime < $banUntil) {
                return false; // Користувач ще в бані
            }
        }

        // Перевіряємо, чи токсичне повідомлення
        if ($this->is_toxic($message)) {
            if ($banInfo) {
                $violations = $banInfo['violations'] + 1;
            } else {
                $violations = 1;
            }

            if ($violations >= 3) {
                $banTime = new DateTime();
                $banTime->modify('+2 minutes'); // Бан на 2 хвилини
                $banUntilStr = $banTime->format('Y-m-d H:i:s');

                $query = "INSERT INTO user_bans (user_id, violations, ban_until) 
                      VALUES (:user_id, :violations, :ban_until)
                      ON DUPLICATE KEY UPDATE violations = :violations, ban_until = :ban_until";
                $stmt = $this->connect->prepare($query);
                $stmt->execute(['user_id' => $user_id, 'violations' => $violations, 'ban_until' => $banUntilStr]);

                return false;
            } else {
                $query = "INSERT INTO user_bans (user_id, violations) 
                      VALUES (:user_id, :violations)
                      ON DUPLICATE KEY UPDATE violations = :violations";
                $stmt = $this->connect->prepare($query);
                $stmt->execute(['user_id' => $user_id, 'violations' => $violations]);

                return false;
            }
        }

        $query = "INSERT INTO chatrooms (user_id, message, created_on) VALUES (:user_id, :message, NOW())";
        $stmt = $this->connect->prepare($query);
        $stmt->execute(['user_id' => $user_id, 'message' => $message]);

        return true;
    }
}
	
?>
