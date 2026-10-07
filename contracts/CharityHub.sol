// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Common Good — transparent, flexible-funding charity campaigns.
/// @notice Sepolia coursework demonstration. A campaign is not a verified charity.
/// Donations are final; beneficiaries may withdraw before a goal is reached.
contract CharityHub {
    string public constant APP_ID = "common-good-v1";
    address public immutable owner;
    uint256 public constant MAX_DONATION = 1 ether;
    uint256 public totalDonated;
    uint256 public totalWithdrawn;
    uint256 public donationCount;
    bool private entered;

    struct Campaign {
        uint256 id;
        string title;
        string description;
        address payable beneficiary;
        uint256 goal;
        uint256 raised;
        uint256 withdrawn;
        uint256 donationCount;
        uint256 deadline;
        bool paused;
    }
    struct Activity {
        uint256 id;
        uint256 campaignId;
        address actor;
        uint256 amount;
        uint8 kind; // 0 = donation; 1 = beneficiary withdrawal
        uint256 timestamp;
        uint256 blockNumber;
    }

    Campaign[] private campaigns;
    Activity[] private activities;
    mapping(address => uint256[]) private personalActivity;
    mapping(address => uint256) public donorTotal;
    mapping(address => uint256) public donorCount;
    mapping(uint256 => mapping(address => uint256)) public donatedTo;

    event CampaignCreated(uint256 indexed campaignId, address indexed beneficiary, string title);
    event CampaignPauseChanged(uint256 indexed campaignId, bool paused);
    event ActivityRecorded(uint256 indexed activityId, uint256 indexed campaignId,
        address indexed actor, uint256 amount, uint8 kind, uint256 timestamp);

    modifier onlyOwner() { require(msg.sender == owner, "Only the administrator"); _; }
    modifier nonReentrant() { require(!entered, "Reentrant call"); entered = true; _; entered = false; }
    modifier validCampaign(uint256 id) { require(id < campaigns.length, "Campaign not found"); _; }

    constructor() {
        owner = msg.sender;
        // Seeded test campaigns send withdrawals to the deployer's wallet.
        _create("Community pantry", "Help stock a neighbourhood pantry with everyday essentials.", payable(msg.sender), 0.1 ether, 180);
        _create("Learning essentials", "Support learning materials and access to study resources.", payable(msg.sender), 0.08 ether, 180);
        _create("Emergency relief", "Support a small community emergency assistance fund.", payable(msg.sender), 0.15 ether, 180);
    }

    function createCampaign(string calldata title, string calldata description,
        address payable beneficiary, uint256 goal, uint256 durationDays) external onlyOwner {
        _create(title, description, beneficiary, goal, durationDays);
    }

    function _create(string memory title, string memory description,
        address payable beneficiary, uint256 goal, uint256 durationDays) private {
        require(bytes(title).length >= 3 && bytes(title).length <= 64, "Title must be 3-64 bytes");
        require(bytes(description).length >= 10 && bytes(description).length <= 240, "Description must be 10-240 bytes");
        require(beneficiary != address(0) && beneficiary != address(this), "Invalid beneficiary");
        require(goal > 0 && goal <= 100 ether, "Goal must be over zero and at most 100 ETH");
        require(durationDays >= 1 && durationDays <= 365, "Duration must be 1-365 days");
        require(campaigns.length < 32, "Campaign limit reached");
        uint256 id = campaigns.length;
        campaigns.push(Campaign(id, title, description, beneficiary, goal, 0, 0, 0,
            block.timestamp + durationDays * 1 days, false));
        emit CampaignCreated(id, beneficiary, title);
    }

    function donate(uint256 id) external payable nonReentrant validCampaign(id) {
        Campaign storage c = campaigns[id];
        require(!c.paused, "Campaign is paused");
        require(block.timestamp < c.deadline, "Campaign has ended");
        require(msg.value > 0 && msg.value <= MAX_DONATION, "Donate over zero and at most 1 ETH");
        c.raised += msg.value;
        c.donationCount += 1;
        totalDonated += msg.value;
        donationCount += 1;
        donatedTo[id][msg.sender] += msg.value;
        donorTotal[msg.sender] += msg.value;
        donorCount[msg.sender] += 1;
        _record(id, msg.value, 0);
    }

    function withdraw(uint256 id) external nonReentrant validCampaign(id) {
        Campaign storage c = campaigns[id];
        require(msg.sender == c.beneficiary, "Only the beneficiary");
        uint256 amount = c.raised - c.withdrawn;
        require(amount > 0, "No funds to withdraw");
        // Checks -> effects -> interaction. A failed transfer rolls back all effects.
        c.withdrawn += amount;
        totalWithdrawn += amount;
        _record(id, amount, 1);
        (bool sent, ) = c.beneficiary.call{value: amount}("");
        require(sent, "Beneficiary transfer failed");
    }

    function setPaused(uint256 id, bool paused) external onlyOwner validCampaign(id) {
        campaigns[id].paused = paused;
        emit CampaignPauseChanged(id, paused);
    }

    function _record(uint256 campaignId, uint256 amount, uint8 kind) private {
        uint256 id = activities.length;
        activities.push(Activity(id, campaignId, msg.sender, amount, kind, block.timestamp, block.number));
        personalActivity[msg.sender].push(id);
        emit ActivityRecorded(id, campaignId, msg.sender, amount, kind, block.timestamp);
    }

    function getOverview() external view returns(address administrator, uint256 campaignCount,
        uint256 donated, uint256 withdrawn, uint256 contributions, uint256 activityCount) {
        return (owner, campaigns.length, totalDonated, totalWithdrawn, donationCount, activities.length);
    }
    function getCampaign(uint256 id) external view validCampaign(id) returns(Campaign memory) { return campaigns[id]; }
    function getCampaigns() external view returns(Campaign[] memory) { return campaigns; }
    function getActivityCount(address account) external view returns(uint256) { return personalActivity[account].length; }

    /// @param cursor 0 starts at the newest record; returned nextCursor resumes older records.
    function getHistory(uint256 cursor, uint256 limit, address account) external view returns(
        Activity[] memory records, uint256 nextCursor, bool hasMore) {
        require(limit >= 1 && limit <= 20, "History limit must be 1-20");
        uint256 length = account == address(0) ? activities.length : personalActivity[account].length;
        uint256 end = cursor == 0 ? length : cursor;
        require(end <= length, "Invalid history cursor");
        uint256 size = end < limit ? end : limit;
        records = new Activity[](size);
        for (uint256 i; i < size; ++i) {
            uint256 index = end - 1 - i;
            records[i] = activities[account == address(0) ? index : personalActivity[account][index]];
        }
        nextCursor = end - size;
        hasMore = nextCursor > 0;
    }
    receive() external payable { revert("Use donate(campaignId)"); }
    fallback() external payable { revert("Unknown function"); }
}
